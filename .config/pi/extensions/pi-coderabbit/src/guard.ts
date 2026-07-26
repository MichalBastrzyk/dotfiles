/**
 * Conservative best-effort guard for model-issued bash commands.
 *
 * This is intentionally not presented as a security boundary: a shell command can
 * obscure an executable through variables, generated scripts, or another process.
 * Its purpose is to prevent normal/direct agent invocation of CodeRabbit so review
 * credits remain controlled by the user's explicit `/cr` command.
 */
export const looksLikeCodeRabbitInvocation = (command: string): boolean => {
  const normalized = command.replaceAll("\\\n", " ");

  return /(?:^|[\s;&|()'"`])(?:[^\s;&|()'"`]*\/)?(?:cr|coderabbit)(?=\s|$)/u.test(normalized);
};
