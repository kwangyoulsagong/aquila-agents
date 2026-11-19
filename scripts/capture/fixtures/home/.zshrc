# Fixture shell for `npm run capture`: a neutral prompt (no user or host name) and the demo CLIs first on PATH.
export PATH="$HOME/bin:$PATH"
PROMPT='%F{blue}%1~%f %# '
RPROMPT=''
unsetopt PROMPT_SP
