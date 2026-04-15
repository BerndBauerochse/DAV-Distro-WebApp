#!/bin/bash
# ============================================================
# DAV Distro – SFTP-Setup auf dem Server
# Ausführen als root auf 94.130.65.4
# ============================================================
set -e

SFTP_USER="dav-upload"
STORAGE_DIR="/opt/dav-storage"

echo "==> Erstelle Verzeichnisstruktur..."
mkdir -p "$STORAGE_DIR/zips"
mkdir -p "$STORAGE_DIR/toc"
mkdir -p "$STORAGE_DIR/pdf"

echo "==> Erstelle SFTP-Benutzer '$SFTP_USER'..."
if id "$SFTP_USER" &>/dev/null; then
    echo "    Benutzer existiert bereits."
else
    useradd -m -s /usr/sbin/nologin "$SFTP_USER"
    echo "    Benutzer erstellt."
fi

echo "==> Setze Berechtigungen..."
# Storage-Root gehört root (SFTP chroot-Anforderung)
chown root:root "$STORAGE_DIR"
chmod 755 "$STORAGE_DIR"

# Unterordner gehören dem SFTP-User
chown -R "$SFTP_USER:$SFTP_USER" "$STORAGE_DIR/zips"
chown -R "$SFTP_USER:$SFTP_USER" "$STORAGE_DIR/toc"
chown -R "$SFTP_USER:$SFTP_USER" "$STORAGE_DIR/pdf"

# SSH-Key-Verzeichnis für den User
SSH_DIR="/home/$SFTP_USER/.ssh"
mkdir -p "$SSH_DIR"
chown "$SFTP_USER:$SFTP_USER" "$SSH_DIR"
chmod 700 "$SSH_DIR"

touch "$SSH_DIR/authorized_keys"
chown "$SFTP_USER:$SFTP_USER" "$SSH_DIR/authorized_keys"
chmod 600 "$SSH_DIR/authorized_keys"

echo "==> Konfiguriere sshd für SFTP-Chroot..."
SSHD_CONF="/etc/ssh/sshd_config"
MARKER="# DAV-Distro SFTP"

if grep -q "$MARKER" "$SSHD_CONF"; then
    echo "    sshd_config bereits konfiguriert."
else
    cat >> "$SSHD_CONF" << EOF

$MARKER
Match User $SFTP_USER
    ChrootDirectory $STORAGE_DIR
    ForceCommand internal-sftp
    AllowTcpForwarding no
    X11Forwarding no
EOF
    echo "    sshd_config aktualisiert."
    systemctl restart sshd
    echo "    sshd neu gestartet."
fi

echo ""
echo "============================================================"
echo " SFTP-Setup abgeschlossen!"
echo "============================================================"
echo ""
echo " Host:      94.130.65.4"
echo " Port:      22"
echo " Benutzer:  $SFTP_USER"
echo " Ordner:    /zips   /toc   /pdf"
echo ""
echo " NÄCHSTER SCHRITT – SSH-Key hinterlegen:"
echo " Füge deinen Public Key ein:"
echo ""
echo "   echo 'ssh-rsa AAAA...' >> $SSH_DIR/authorized_keys"
echo ""
echo " Zum Testen (von Windows/PowerShell):"
echo "   sftp $SFTP_USER@94.130.65.4"
echo ""
echo " In WinSCP / FileZilla:"
echo "   Protokoll: SFTP"
echo "   Host:      94.130.65.4"
echo "   Port:      22"
echo "   Benutzer:  $SFTP_USER"
echo "   Auth:      SSH-Key (nicht Passwort)"
echo "============================================================"
