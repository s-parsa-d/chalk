import chalk from 'chalk';

// Register themes — either from a style chain or raw ANSI codes
chalk.defineTheme('danger', chalk.bold.red);
chalk.defineTheme('success', chalk.hex('#00C853'));
chalk.defineTheme('brand', {open: '\u{1B}[38;5;208m', close: '\u{1B}[39m'}); // E.g. loaded from a JSON config

// Check existence
console.log(chalk.hasTheme('danger')); //=> true

// Apply by name — the theme name becomes a style, just like built-in ones
console.log(chalk.danger('Something went wrong!'));

// Chain like any other style (before or after)
console.log(chalk.success.bold('Done ✓'));
console.log(chalk.bgBlackBright.brand('brand on black'));

// For names only known at runtime, use `theme()` — unknown names throw a helpful error
// console.log(chalk.theme('does-not-exist'));

// Redefining overwrites silently (last write wins)
chalk.defineTheme('danger', chalk.red);
console.log(chalk.danger('Now plain red'));
