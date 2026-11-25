export const frozenLaunchArguments = (argumentsFromConfig: string[] | undefined, cachePath: string): string[] => {
  const result: string[] = []
  let hasCacheDirectory = false
  for (const rawArgument of argumentsFromConfig ?? []) {
    const argument = rawArgument.trim()
    if (!argument || argument.toLowerCase() === '-nosteam') continue
    if (argument.toLowerCase().startsWith('-cachedir=')) {
      if (!hasCacheDirectory) result.push(`-cachedir=${cachePath}`)
      hasCacheDirectory = true
      continue
    }
    result.push(argument)
  }
  if (!hasCacheDirectory) result.push(`-cachedir=${cachePath}`)
  return result
}
