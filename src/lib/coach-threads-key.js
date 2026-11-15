// The coach's local memory key lives in its own tiny module so the store can
// wipe it on sign-out without pulling the exercise catalogue into its import graph.
export const COACH_THREADS_KEY = 'gym_coach_threads_v1'
