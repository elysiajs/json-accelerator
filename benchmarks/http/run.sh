#!/bin/bash
# HTTP loadtest gate: RPS per serialization mode, interleaved rounds to
# cancel thermal/scheduler drift. Usage: ./run.sh [duration] [connections] [rounds]
set -e
cd "$(dirname "$0")"

DUR=${1:-5s}
CONN=${2:-64}
ROUNDS=${3:-3}
MODES=${MODES:-stringify accelerator bytes}

for round in $(seq 1 "$ROUNDS"); do
	for mode in $MODES; do
		MODE=$mode PAYLOAD=${PAYLOAD:-medium} PORT=3123 bun server.ts &
		PID=$!
		sleep 0.6
		# warmup for JIT
		oha -z 2s -c "$CONN" --no-tui http://127.0.0.1:3123/ > /dev/null
		RPS=$(oha -z "$DUR" -c "$CONN" --no-tui --output-format json http://127.0.0.1:3123/ | bun -e "const j=await new Response(Bun.stdin.stream()).json();console.log(j.summary.requestsPerSec.toFixed(0))")
		echo "round$round ${PAYLOAD:-medium} $mode $RPS"
		kill $PID 2>/dev/null
		wait $PID 2>/dev/null || true
	done
done
