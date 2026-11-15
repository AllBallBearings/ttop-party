const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

/**
 * Returns all non-internal IPv4 addresses on this machine.
 */
function getLanIPv4Addresses() {
  const interfaces = os.networkInterfaces();
  const addresses = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        addresses.push(iface.address);
      }
    }
  }
  return addresses;
}

/**
 * Ensures a self-signed TLS certificate exists for localhost and all current LAN IPs.
 * Mobile browsers (iOS Safari / Android Chrome) require HTTPS for camera access over LAN.
 */
function ensureTlsCertificates(certsDir) {
  fs.mkdirSync(certsDir, { recursive: true });

  const keyPath = path.join(certsDir, 'key.pem');
  const certPath = path.join(certsDir, 'cert.pem');
  const sanRecordPath = path.join(certsDir, 'san.txt');
  const opensslConfigPath = path.join(certsDir, 'openssl.cnf');

  const lanIps = getLanIPv4Addresses();
  const sanEntries = ['DNS:localhost', 'IP:127.0.0.1', ...lanIps.map((ip) => `IP:${ip}`)];
  const sanKey = sanEntries.join(',');

  const hasFiles = fs.existsSync(keyPath) && fs.existsSync(certPath) && fs.existsSync(sanRecordPath);
  if (hasFiles && fs.readFileSync(sanRecordPath, 'utf8').trim() === sanKey) {
    return {
      key: fs.readFileSync(keyPath),
      cert: fs.readFileSync(certPath),
      lanIps,
    };
  }

  const altNamesLines = [
    'DNS.1 = localhost',
    'IP.1 = 127.0.0.1',
    ...lanIps.map((ip, idx) => `IP.${idx + 2} = ${ip}`),
  ].join('\n');

  const opensslConfig = `[req]
default_bits = 2048
prompt = no
default_md = sha256
x509_extensions = v3_req
distinguished_name = dn

[dn]
CN = Tabletop AR Suite Local

[v3_req]
subjectAltName = @alt_names
basicConstraints = CA:FALSE
keyUsage = digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth

[alt_names]
${altNamesLines}
`;

  fs.writeFileSync(opensslConfigPath, opensslConfig, 'utf8');

  execFileSync('openssl', [
    'req',
    '-x509',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-days',
    '365',
    '-keyout',
    keyPath,
    '-out',
    certPath,
    '-config',
    opensslConfigPath,
  ], { stdio: 'pipe' });

  fs.writeFileSync(sanRecordPath, sanKey, 'utf8');

  return {
    key: fs.readFileSync(keyPath),
    cert: fs.readFileSync(certPath),
    lanIps,
  };
}

module.exports = {
  getLanIPv4Addresses,
  ensureTlsCertificates,
};
