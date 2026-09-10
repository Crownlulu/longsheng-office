#!/usr/bin/env bash
# Run from the linked project directory in Git Bash. No secrets in arguments.
set -euo pipefail
if [[ ! -f .vercel/project.json ]]; then
  echo '请在已经 vercel link 成功的 longsheng-office-vercel-fix 文件夹运行。'
  exit 1
fi
node --input-type=module - <<'JS'
import { readFileSync, mkdirSync, existsSync, writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
const linked = JSON.parse(readFileSync('.vercel/project.json', 'utf8'))
if (linked.projectName && linked.projectName !== 'longsheng-office') throw new Error('当前关联的不是 longsheng-office，请先核对项目。')
mkdirSync('.runtime/cloud-setup', { recursive: true, mode: 0o700 })
const values = {
  OFFICE_ACCESS_CODE: () => randomBytes(12).toString('hex'),
  OFFICE_CONFIG_KEY: () => randomBytes(32).toString('hex'),
  OFFICE_PUBLIC_ORIGIN: () => 'https://longsheng-office.vercel.app',
  OFFICE_MODEL_MODE: () => 'rules',
}
for (const [name, generate] of Object.entries(values)) {
  const path = `.runtime/cloud-setup/${name}`
  if (!existsSync(path)) writeFileSync(path, generate(), { mode: 0o600, flag: 'wx' })
}
JS
for target in production preview; do
  for name in OFFICE_ACCESS_CODE OFFICE_CONFIG_KEY OFFICE_PUBLIC_ORIGIN OFFICE_MODEL_MODE; do
    marker=".runtime/cloud-setup/${name}.${target}.done"
    if [[ -f "$marker" ]]; then continue; fi
    echo "正在配置 ${target}: ${name}"
    # No --force: existing remote settings are never silently replaced.
    if ! npx --yes vercel@59.15.1 env add "$name" "$target" --sensitive --yes --scope lzk3320789-5817 < ".runtime/cloud-setup/$name"; then
      echo '配置未完成，已停止。请只发送上方报错，不要发送密钥文件。'
      exit 1
    fi
    touch "$marker"
  done
done
echo 'CLOUD CONFIG READY'
echo '配置已完成。网页访问码保存在 .runtime/cloud-setup/OFFICE_ACCESS_CODE。'
echo '请保留 .runtime/cloud-setup 文件夹；脚本再次运行会沿用原密钥。'
echo '下一步：npx vercel@59.15.1 deploy --yes'
