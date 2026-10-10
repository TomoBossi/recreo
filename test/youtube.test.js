import { test, assert } from './harness.js'
import { videoId, clock } from '../app/youtube.js'

test('a YouTube link of any usual shape gives its video id', () => {
  for (const link of [
    'dQw4w9WgXcQ',
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    'https://youtube.com/watch?v=dQw4w9WgXcQ&t=42s&list=PL123',
    'youtube.com/watch?v=dQw4w9WgXcQ',
    'https://m.youtube.com/watch?v=dQw4w9WgXcQ',
    'https://music.youtube.com/watch?v=dQw4w9WgXcQ',
    'https://youtu.be/dQw4w9WgXcQ',
    'https://youtu.be/dQw4w9WgXcQ?si=abc',
    'https://www.youtube.com/shorts/dQw4w9WgXcQ',
    'https://www.youtube.com/embed/dQw4w9WgXcQ',
    'https://www.youtube.com/live/dQw4w9WgXcQ',
    'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
    '  https://youtu.be/dQw4w9WgXcQ  ',
  ]) assert.equal(videoId(link), 'dQw4w9WgXcQ', link)
})

test('anything else gives no video id', () => {
  for (const text of ['', 'hello', 'https://vimeo.com/123456789', 'https://example.com/watch?v=dQw4w9WgXcQ', 'https://youtube.com/watch?v=short', 'https://www.youtube.com/', 'dQw4w9WgXc'])
    assert.equal(videoId(text), null, text)
})

test('positions read as minutes and seconds, hours when there are some', () => {
  assert.equal(clock(0), '0:00')
  assert.equal(clock(83.9), '1:23')
  assert.equal(clock(3723), '1:02:03')
  assert.equal(clock(-5), '0:00')
  assert.equal(clock(NaN), '0:00')
})
