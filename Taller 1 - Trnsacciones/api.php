<?php
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST');
header('Access-Control-Allow-Headers: Content-Type');


$DB_HOST = 'localhost';
$DB_NAME = 'transactcore';
$DB_USER = 'root';
$DB_PASS = 'root';


try {
    $pdo = new PDO(
        "mysql:host=$DB_HOST;dbname=$DB_NAME;charset=utf8mb4",
        $DB_USER,
        $DB_PASS,
        [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false,
        ]
    );
} catch (PDOException $e) {
    sendError('Error de conexión a la base de datos: ' . $e->getMessage());
}


const ADMIN_USERNAME = 'admin';
const ADMIN_PASSWORD_HASH = '$2y$10$YourBcryptHashHere'; // Generar con password_hash('admin123', PASSWORD_BCRYPT)
const MAX_LOGIN_ATTEMPTS = 3;

$COMMISSION_RATES = [
    'deposit' => 0.001,
    'withdrawal' => 0.010,
    'transfer' => 0.005,
    'payment' => 0.008,
];


function sendSuccess($data = null, $message = '') {
    echo json_encode(['success' => true, 'data' => $data, 'message' => $message]);
    exit;
}

function sendError($message) {
    echo json_encode(['success' => false, 'message' => $message]);
    exit;
}

function hashPassword($password) {
    // Usar bcrypt (recomendado para producción)
    if (function_exists('password_hash')) {
        return password_hash($password, PASSWORD_BCRYPT);
    }
    // Fallback a SHA-256 si bcrypt no está disponible
    return 'sha256:' . hash('sha256', $password);
}

function verifyPassword($password, $hash) {
    if (substr($hash, 0, 7) === 'sha256:') {
        // Verificar SHA-256
        return $hash === 'sha256:' . hash('sha256', $password);
    }
    // Verificar bcrypt
    return password_verify($password, $hash);
}

function auditLog($pdo, $actor, $action, $detail, $level = 'info') {
    $stmt = $pdo->prepare('INSERT INTO audit_log (actor, action, detail, level) VALUES (?, ?, ?, ?)');
    $stmt->execute([$actor, $action, $detail, $level]);
}


$input = json_decode(file_get_contents('php://input'), true);
$action = $input['action'] ?? '';


if ($action === 'register') {
    $name = trim($input['name'] ?? '');
    $username = trim(strtolower($input['username'] ?? ''));
    $password = $input['password'] ?? '';

    if (empty($name) || empty($username) || empty($password)) {
        sendError('Todos los campos son obligatorios.');
    }

    if (!preg_match('/^[a-zA-Z0-9._]{3,30}$/', $username)) {
        sendError('Usuario inválido (3-30 caracteres alfanuméricos, . o _).');
    }

    if (strlen($password) < 6) {
        sendError('La contraseña debe tener al menos 6 caracteres.');
    }

    
    $stmt = $pdo->prepare('SELECT id FROM users WHERE username = ?');
    $stmt->execute([$username]);
    if ($stmt->fetch()) {
        sendError('El usuario ya existe.');
    }

    
    $passwordHash = hashPassword($password);
    $stmt = $pdo->prepare('INSERT INTO users (name, username, password_hash, balance) VALUES (?, ?, ?, 0.00)');
    $stmt->execute([$name, $username, $passwordHash]);

    auditLog($pdo, $username, 'USER_REGISTERED', "Usuario $name registrado", 'ok');
    sendSuccess(null, 'Usuario registrado correctamente.');
}


if ($action === 'login') {
    $username = trim($input['username'] ?? '');
    $password = $input['password'] ?? '';
    $role = $input['role'] ?? 'user';

    if (empty($username) || empty($password)) {
        sendError('Usuario y contraseña son obligatorios.');
    }

    
    if ($role === 'admin') {
        if ($username !== ADMIN_USERNAME) {
            sendError('Usuario administrador incorrecto.');
        }
        
        
        if ($password !== 'admin123') {
            sendError('Contraseña incorrecta.');
        }

        auditLog($pdo, 'admin', 'LOGIN', 'Acceso como administrador', 'ok');
        sendSuccess([
            'role' => 'admin',
            'user' => null
        ]);
    }

    // LOGIN USUARIO
    $stmt = $pdo->prepare('SELECT * FROM users WHERE username = ?');
    $stmt->execute([$username]);
    $user = $stmt->fetch();

    if (!$user) {
        sendError('Usuario no encontrado.');
    }

    if ($user['locked']) {
        auditLog($pdo, $username, 'LOGIN_BLOCKED', 'Intento en cuenta bloqueada', 'err');
        sendError('Cuenta bloqueada. Contacta al administrador.');
    }

    if (!verifyPassword($password, $user['password_hash'])) {
        $failedLogins = $user['failed_logins'] + 1;
        
        if ($failedLogins >= MAX_LOGIN_ATTEMPTS) {
            $stmt = $pdo->prepare('UPDATE users SET locked = 1, failed_logins = ? WHERE id = ?');
            $stmt->execute([$failedLogins, $user['id']]);
            auditLog($pdo, $username, 'ACCOUNT_LOCKED', "$failedLogins intentos fallidos", 'err');
            sendError('Cuenta bloqueada por demasiados intentos fallidos.');
        }
        
        $stmt = $pdo->prepare('UPDATE users SET failed_logins = ? WHERE id = ?');
        $stmt->execute([$failedLogins, $user['id']]);
        auditLog($pdo, $username, 'LOGIN_FAIL', "Intento $failedLogins/" . MAX_LOGIN_ATTEMPTS, 'warn');
        
        $remaining = MAX_LOGIN_ATTEMPTS - $failedLogins;
        sendError("Contraseña incorrecta. Intentos restantes: $remaining");
    }

    // Login exitoso
    $stmt = $pdo->prepare('UPDATE users SET failed_logins = 0 WHERE id = ?');
    $stmt->execute([$user['id']]);

    auditLog($pdo, $user['name'], 'LOGIN', 'Acceso como usuario', 'ok');
    sendSuccess([
        'role' => 'user',
        'user' => [
            'id' => $user['id'],
            'name' => $user['name'],
            'username' => $user['username'],
            'balance' => $user['balance'],
        ]
    ]);
}


if ($action === 'get_users') {
    $stmt = $pdo->query('SELECT id, name, username, balance, locked, failed_logins, created_at FROM users ORDER BY id ASC');
    $users = $stmt->fetchAll();
    sendSuccess($users);
}


if ($action === 'update_user') {
    $id = $input['id'] ?? 0;
    $name = trim($input['name'] ?? '');
    $balance = $input['balance'] ?? 0;
    $password = $input['password'] ?? null;

    if (empty($name)) {
        sendError('El nombre es obligatorio.');
    }

    if ($balance < 0) {
        sendError('El saldo no puede ser negativo.');
    }

    if ($password !== null && strlen($password) < 6) {
        sendError('La contraseña debe tener al menos 6 caracteres.');
    }

    $stmt = $pdo->prepare('UPDATE users SET name = ?, balance = ? WHERE id = ?');
    $stmt->execute([$name, $balance, $id]);

    if ($password !== null) {
        $hash = hashPassword($password);
        $stmt = $pdo->prepare('UPDATE users SET password_hash = ? WHERE id = ?');
        $stmt->execute([$hash, $id]);
    }

    auditLog($pdo, 'admin', 'USER_UPDATED', "Usuario ID $id actualizado", 'info');
    sendSuccess(null, 'Usuario actualizado correctamente.');
}


if ($action === 'delete_user') {
    $id = $input['id'] ?? 0;
    
    $stmt = $pdo->prepare('SELECT name FROM users WHERE id = ?');
    $stmt->execute([$id]);
    $user = $stmt->fetch();
    
    if (!$user) {
        sendError('Usuario no encontrado.');
    }

    $stmt = $pdo->prepare('DELETE FROM users WHERE id = ?');
    $stmt->execute([$id]);

    auditLog($pdo, 'admin', 'USER_DELETED', "Usuario {$user['name']} (ID $id) eliminado", 'warn');
    sendSuccess(null, 'Usuario eliminado correctamente.');
}


if ($action === 'unlock_user') {
    $id = $input['id'] ?? 0;
    
    $stmt = $pdo->prepare('SELECT name FROM users WHERE id = ?');
    $stmt->execute([$id]);
    $user = $stmt->fetch();
    
    if (!$user) {
        sendError('Usuario no encontrado.');
    }

    $stmt = $pdo->prepare('UPDATE users SET locked = 0, failed_logins = 0 WHERE id = ?');
    $stmt->execute([$id]);

    auditLog($pdo, 'admin', 'USER_UNLOCKED', "Usuario {$user['name']} (ID $id) desbloqueado", 'ok');
    sendSuccess(null, 'Usuario desbloqueado correctamente.');
}


if ($action === 'create_transaction') {
    global $COMMISSION_RATES;
    
    $userId = $input['userId'] ?? 0;
    $type = $input['type'] ?? '';
    $amount = floatval($input['amount'] ?? 0);
    $destId = $input['destId'] ?? null;
    $description = trim($input['description'] ?? '');

    if (!$userId || !in_array($type, ['deposit', 'withdrawal', 'transfer', 'payment'])) {
        sendError('Datos de transacción inválidos.');
    }

    if ($amount <= 0) {
        sendError('El monto debe ser mayor a cero.');
    }

    if ($amount > 500000) {
        sendError('El monto excede el límite permitido ($500,000).');
    }

    // Obtener usuario origen
    $stmt = $pdo->prepare('SELECT * FROM users WHERE id = ?');
    $stmt->execute([$userId]);
    $user = $stmt->fetch();
    
    if (!$user) {
        sendError('Usuario no encontrado.');
    }

    // Calcular comisión
    $commission = round($amount * $COMMISSION_RATES[$type], 2);
    $totalDebit = $type !== 'deposit' ? round($amount + $commission, 2) : 0;

    // Validar saldo
    if ($type !== 'deposit' && $user['balance'] < $totalDebit) {
        auditLog($pdo, $user['name'], 'TX_REJECTED', "Saldo insuficiente ($totalDebit requerido)", 'err');
        sendError("Saldo insuficiente. Disponible: \${$user['balance']}, necesario: \$$totalDebit");
    }

    // Obtener usuario destino (si es transferencia)
    $dest = null;
    $destName = null;
    if ($type === 'transfer') {
        if (!$destId || $destId === $userId) {
            sendError('Selecciona un usuario destino válido.');
        }
        $stmt = $pdo->prepare('SELECT * FROM users WHERE id = ?');
        $stmt->execute([$destId]);
        $dest = $stmt->fetch();
        if (!$dest) {
            sendError('Usuario destino no encontrado.');
        }
        $destName = $dest['name'];
    }

    // Iniciar transacción de BD
    $pdo->beginTransaction();

    try {
        // Aplicar movimientos
        if ($type === 'deposit') {
            $stmt = $pdo->prepare('UPDATE users SET balance = balance + ? WHERE id = ?');
            $stmt->execute([$amount, $userId]);
        } else {
            $stmt = $pdo->prepare('UPDATE users SET balance = balance - ? WHERE id = ?');
            $stmt->execute([$totalDebit, $userId]);
            
            if ($type === 'transfer' && $dest) {
                $stmt = $pdo->prepare('UPDATE users SET balance = balance + ? WHERE id = ?');
                $stmt->execute([$amount, $destId]);
            }
        }

        // Insertar transacción
        $stmt = $pdo->prepare('
            INSERT INTO transactions 
            (user_id, user_name, dest_id, dest_name, type, amount, commission, description, status) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ');
        $stmt->execute([
            $userId,
            $user['name'],
            $destId,
            $destName,
            $type,
            $amount,
            $commission,
            $description,
            'ok'
        ]);

        $txId = $pdo->lastInsertId();

        $pdo->commit();

        auditLog($pdo, $user['name'], 'TX_OK', "TX ID $txId · $type \$$amount", 'ok');
        sendSuccess(['tx_id' => $txId], 'Transacción procesada correctamente.');
        
    } catch (Exception $e) {
        $pdo->rollBack();
        sendError('Error al procesar la transacción: ' . $e->getMessage());
    }
}


if ($action === 'get_transactions') {
    $userId = $input['userId'] ?? null;
    
    if ($userId) {
        $stmt = $pdo->prepare('SELECT * FROM transactions WHERE user_id = ? ORDER BY timestamp DESC LIMIT 100');
        $stmt->execute([$userId]);
    } else {
        $stmt = $pdo->query('SELECT * FROM transactions ORDER BY timestamp DESC LIMIT 100');
    }
    
    $transactions = $stmt->fetchAll();
    sendSuccess($transactions);
}


if ($action === 'get_audit_log') {
    $stmt = $pdo->query('SELECT * FROM audit_log ORDER BY timestamp DESC LIMIT 100');
    $logs = $stmt->fetchAll();
    sendSuccess($logs);
}


if ($action === 'clear_history') {
    $stmt = $pdo->exec('DELETE FROM transactions');
    auditLog($pdo, 'admin', 'HISTORY_CLEARED', 'Historial de transacciones borrado', 'warn');
    sendSuccess(null, 'Historial limpiado correctamente.');
}

sendError('Acción no válida.');
