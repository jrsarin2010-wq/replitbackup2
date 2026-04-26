#!/bin/bash
# install-hooks.sh — Instala os git hooks do projeto.
# Chamado automaticamente pelo setup-git.sh após reinicializações de container.
#
# Uso:
#   bash scripts/install-hooks.sh

HOOKS_DIR=".git/hooks"

if [ ! -d "$HOOKS_DIR" ]; then
  echo "⚠️  Diretório .git/hooks não encontrado. Rode dentro da raiz do projeto."
  exit 1
fi

cat > "$HOOKS_DIR/post-commit" << 'EOF'
#!/bin/bash

# Auto-push para GitHub após cada commit (Claude Code ou Replit Agent)
REPO_MAIN="https://x-access-token:${GITHUB_RAILWAY_TOKEN}@github.com/jrsarin2010-wq/ReplitRailway.git"
REPO_BACKUP="https://x-access-token:${GITHUB_RAILWAY_TOKEN}@github.com/jrsarin2010-wq/replirailwaybackup.git"

if [ -z "$GITHUB_RAILWAY_TOKEN" ]; then
  echo "⚠️  [post-commit] GITHUB_RAILWAY_TOKEN não encontrado — push automático ignorado."
  exit 0
fi

echo "🔄 [post-commit] Enviando para GitHub..."

git push --force "$REPO_MAIN" HEAD:main 2>&1 && echo "✅ ReplitRailway atualizado." || echo "❌ Falha no ReplitRailway."
git push --force "$REPO_BACKUP" HEAD:main 2>&1 && echo "✅ replirailwaybackup atualizado." || echo "❌ Falha no replirailwaybackup."
EOF

chmod +x "$HOOKS_DIR/post-commit"

echo "✅ Hook post-commit instalado — todo commit será enviado automaticamente ao GitHub."
