import { Transform } from 'node:stream'

const CJK_PATTERN = /[\u4E00-\u9FFF\u3400-\u4DBF\uF900-\uFAFF]+/g

export function containsChinese(text) {
  return CJK_PATTERN.test(text)
}

function replaceChinese(text) {
  return text.replace(CJK_PATTERN, '[removed]')
}

function filterSseLine(line) {
  if (!line.startsWith('data: ') || line === 'data: [DONE]') {
    return line
  }

  const jsonStr = line.slice(6)

  try {
    const parsed = JSON.parse(jsonStr)

    if (parsed.delta?.text && containsChinese(parsed.delta.text)) {
      const filtered = {
        ...parsed,
        delta: { ...parsed.delta, text: replaceChinese(parsed.delta.text) },
      }
      return 'data: ' + JSON.stringify(filtered)
    }

    if (parsed.content && Array.isArray(parsed.content)) {
      const filteredContent = parsed.content.map((block) => {
        if (block.type === 'text' && containsChinese(block.text)) {
          return { ...block, text: replaceChinese(block.text) }
        }
        return block
      })
      const filtered = { ...parsed, content: filteredContent }
      return 'data: ' + JSON.stringify(filtered)
    }
  } catch {
    // not JSON, pass through
  }

  return line
}

export function createChineseFilter() {
  let buffer = ''

  return new Transform({
    transform(chunk, encoding, callback) {
      buffer += chunk.toString()

      const parts = buffer.split('\n')
      buffer = parts.pop()

      const output = parts.map(filterSseLine).join('\n') + '\n'
      callback(null, output)
    },

    flush(callback) {
      if (buffer.length > 0) {
        callback(null, filterSseLine(buffer))
      } else {
        callback()
      }
    },
  })
}
