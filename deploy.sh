#!/bin/bash
# 서버(https://miriansim.duckdns.org)에 GitHub main 에 있는 것만 올린다.
#
# 예전엔 rsync 로 작업 폴더를 통째로 밀어 올렸다. 커밋 안 한 것까지 라이브로 나가서
# "서버에 지금 뭐가 올라가 있는지"를 git 으로 확인할 수 없었다. 이제 서버가 직접 받아간다.
# 커밋 안 한 변경은 그냥 안 올라간다 — 서버는 origin/main 그대로가 된다.
#
# .env.local 과 gcp-tts.json 은 gitignore 라 여기로 안 간다 — 서버에 이미 있고,
# git reset --hard 는 untracked 파일을 안 건드리므로 그대로 남는다.
# 이 둘을 바꿔야 하면 scp 로 직접 올린다.
#
# 새로 만든 data/*.json 을 앱이 import 하기 시작했다면 반드시 커밋해야 한다.
# rsync 때는 그냥 올라갔지만 이제는 커밋 안 하면 서버에 없어서 빌드가 깨진다.
set -e
cd "$(dirname "$0")"

echo "→ push"
git push

echo "→ 서버에서 받고 빌드 (1~2분)"
ssh miri 'set -e
  cd ~/app
  [ -d .git ] || { git init -q && git remote add origin https://github.com/hnneul/miri-ansim.git; }
  git fetch -q origin main
  git reset -q --hard origin/main
  npm ci --silent && npm run build && sudo systemctl restart miri'

sleep 3
code=$(curl -s -o /dev/null -w '%{http_code}' https://miriansim.duckdns.org)
echo "→ 완료: https://miriansim.duckdns.org ($code) — $(git log --oneline -1 origin/main)"
