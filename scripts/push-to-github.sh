#!/bin/bash

if [ -z "$GITHUB_RAILWAY_TOKEN" ]; then
  echo "❌ GITHUB_RAILWAY_TOKEN não encontrado. Configure o secret no Replit."
  exit 1
fi

REPO_MAIN="https://x-access-token:${GITHUB_RAILWAY_TOKEN}@github.com/jrsarin2010-wq/ReplitRailway.git"
REPO_BACKUP="https://x-access-token:${GITHUB_RAILWAY_TOKEN}@github.com/jrsarin2010-wq/replirailwaybackup.git"
REPO_BACKUP2="https://x-access-token:${GITHUB_RAILWAY_TOKEN}@github.com/jrsarin2010-wq/replitbackup2.git"

FAILED=0

echo "📤 [1/3] Enviando para GitHub principal (ReplitRailway)..."
git push --force "$REPO_MAIN" HEAD:main 2>&1
if [ $? -eq 0 ]; then
  echo "✅ ReplitRailway atualizado."
else
  echo "❌ Falha no ReplitRailway."
  FAILED=1
fi

echo ""
echo "📤 [2/3] Enviando para GitHub backup (replirailwaybackup)..."
git push --force "$REPO_BACKUP" HEAD:main 2>&1
if [ $? -eq 0 ]; then
  echo "✅ replirailwaybackup atualizado."
else
  echo "❌ Falha no replirailwaybackup."
  FAILED=1
fi

echo ""
echo "📤 [3/3] Enviando para GitHub backup2 (replitbackup2)..."
git push --force "$REPO_BACKUP2" HEAD:main 2>&1
if [ $? -eq 0 ]; then
  echo "✅ replitbackup2 atualizado."
else
  echo "❌ Falha no replitbackup2."
  FAILED=1
fi

echo ""
if [ $FAILED -eq 0 ]; then
  echo "✅ Código enviado com sucesso para todos os repositórios!"
else
  echo "⚠️  Um ou mais repositórios falharam. Verifique o token ou a conexão."
  exit 1
fi
