// The math lives in shared/ so the server (and its MCP tools) computes the
// exact same numbers the UI shows.
export { computeTotals, round, money } from '../../shared/calc.js'
