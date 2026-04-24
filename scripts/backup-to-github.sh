#!/bin/bash
# backup-to-github.sh — Envia o projeto para o repositório principal no GitHub.
# O repositório backupreplit é o principal. O Replit roda em segundo plano.
#
# Uso:
#   bash scripts/backup-to-github.sh
#
# Requer a variável de ambiente GITHUB_PERSONAL_ACCESS_TOKEN definida.

set -e

GITHUB_USER="jrsarinho"
MAIN_REPO="backupreplit"

if [ -z "$GITHUB_PERSONAL_ACCESS_TOKEN" ]; then
  echo "Erro: variável GITHUB_PERSONAL_ACCESS_TOKEN não encontrada."
  exit 1
fi

REMOTE_URL="https://${GITHUB_USER}:${GITHUB_PERSONAL_ACCESS_TOKEN}@github.com/${GITHUB_USER}/${MAIN_REPO}.git"

echo "Enviando para o repositório principal (${MAIN_REPO})..."
git push "$REMOTE_URL" main:main

echo ""
echo "Push concluído com sucesso!"
echo "Repositório: https://github.com/${GITHUB_USER}/${MAIN_REPO}"
