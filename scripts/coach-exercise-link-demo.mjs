// Runtime harness: the coach's real answer, the REAL catalogue, no mocks.
//
//   node scripts/coach-exercise-link-demo.mjs
//
// It loads the app's own modules through Vite (so the catalogue is the one the
// app ships) and prints the segments the chat would render for the answer the
// owner got: "que es Abdominal 3/4".
import { createServer } from 'vite'

const ANSWER = '**Abdominal 3/4** es una versión del abdominal tradicional donde haces solo 3/4 del recorrido.'

const vite = await createServer({
  root: process.cwd(),
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'silent',
})
try {
  const { linkifyExercises, splitBold } = await vite.ssrLoadModule('/src/lib/exercise-links.js')
  const { EXIDX, exName } = await vite.ssrLoadModule('/src/lib/exercises.js')

  console.log('answer:', ANSWER)
  console.log('')
  console.log('segments (what the chat renders):')
  for (const seg of linkifyExercises(ANSWER)) {
    if (seg.type === 'link') {
      const ex = EXIDX[seg.id]
      console.log(`  LINK  "${seg.text}"  id=${seg.id}  href=${seg.href}  ->  ${ex ? ex.n : '???'} (${ex ? ex.bp : '?'})`)
    } else {
      console.log(`  text  "${seg.text}"`)
    }
  }
  console.log('')
  console.log('bold runs (the ** the model wrote):')
  for (const run of splitBold(ANSWER)) {
    console.log(`  ${run.bold ? 'bold' : 'plain'} "${run.text}"`)
  }
  console.log('')
  console.log('catalogue name of the linked id:', exName('0001'))
} finally {
  await vite.close()
}
