export async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return ''

  const decoder = new TextDecoder()
  let result = ''
  for await (const chunk of Bun.stdin.stream()) {
    result += decoder.decode(chunk, { stream: true })
  }
  result += decoder.decode()
  return result
}
