#!/bin/bash

export REPO_ROOT=$(git rev-parse --show-toplevel)
source "${REPO_ROOT}/bats/helpers/setup-and-teardown.bash"

TILT_PID_FILE=$REPO_ROOT/bats/.tilt_pid

setup_suite() {
  background buck2 run //dev:up -- --bats=True > "${REPO_ROOT}/bats/.e2e-tilt.log"
  echo $! > "$TILT_PID_FILE"
  await_api_is_up
  await_api_keys_is_up
}

teardown_suite() {
  if [[ -f "$TILT_PID_FILE" ]]; then
    kill "$(cat "$TILT_PID_FILE")" > /dev/null || true
  fi

  buck2 run //dev:down
}

await_api_is_up() {
  server_is_up() {
    exec_graphql 'anon' 'globals'
    network="$(graphql_output '.data.globals.network')"
    [[ "${network}" = "regtest" ]] || exit 1
  }

  retry 300 1 server_is_up
}

await_api_keys_is_up() {
  api_keys_is_up() {
    curl localhost:5397/auth/check || exit 1
  }

  retry 300 1 api_keys_is_up
}
