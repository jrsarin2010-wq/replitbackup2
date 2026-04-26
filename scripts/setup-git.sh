#!/bin/bash
# setup-git.sh — Reconfigura o remote origin com autenticação GitHub.
# Execute este script quando o container Replit reiniciar e o push parar de funcionar.
#
# Uso:
#   bash scripts/setup-git.sh
#
# Requer a variável de ambiente GITHUB_PERSONAL_ACCESS_TOKEN definida.

set -e

GITHUB_USER="jrsarinho"
GITHUB_REPO="backupreplit"

if [ -z "$GITHUB_PERSONAL_ACCESS_TOKEN" ]; then
  echo "Erro: variável GITHUB_PERSONAL_ACCESS_TOKEN não encontrada."
  echo "Configure-a como secret no Replit (ou exporte no terminal) e tente novamente."
  exit 1
fi

git remote set-url origin "https://${GITHUB_USER}:${GITHUB_PERSONAL_ACCESS_TOKEN}@github.com/${GITHUB_USER}/${GITHUB_REPO}.git"

echo "Remote 'origin' configurado: https://github.com/${GITHUB_USER}/${GITHUB_REPO}"
echo ""
echo "Para verificar: git remote -v"
echo "Para fazer push: git push origin main"

# Reinstala o hook post-commit (auto-push para GitHub após cada commit)
bash scripts/install-hooks.sh 2>/dev/null || true
