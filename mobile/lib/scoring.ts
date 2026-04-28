export function calcScore(timeLeft: number, streak: number, timerSeconds: number): number {
  return Math.round(100 * (timeLeft / timerSeconds) * (1 + streak * 0.1))
}
