import test from 'ava';
import chalk, {Chalk} from '../source/index.js';

chalk.level = 1;

test('apply a theme defined from a Chalk style chain', t => {
	chalk.defineTheme('danger', chalk.bold.red);
	t.is(chalk.danger('foo'), '\u{1B}[1m\u{1B}[31mfoo\u{1B}[39m\u{1B}[22m');
});

test('apply a theme defined from a truecolor style chain', t => {
	const instance = new Chalk({level: 3});
	chalk.defineTheme('success', instance.hex('#00C853'));
	t.is(instance.success('foo'), '\u{1B}[38;2;0;200;83mfoo\u{1B}[39m');
});

test('apply a theme defined from raw ANSI codes', t => {
	chalk.defineTheme('brand', {open: '\u{1B}[38;5;208m', close: '\u{1B}[39m'});
	t.is(chalk.brand('foo'), '\u{1B}[38;5;208mfoo\u{1B}[39m');
});

test('theme names chain with other styles like any built-in style', t => {
	chalk.defineTheme('info', chalk.blue);
	t.is(chalk.info.bold('foo'), '\u{1B}[34m\u{1B}[1mfoo\u{1B}[22m\u{1B}[39m');
	t.is(chalk.bold.info('foo'), '\u{1B}[1m\u{1B}[34mfoo\u{1B}[39m\u{1B}[22m');
	t.is(chalk.info.danger('foo'), '\u{1B}[34m\u{1B}[1m\u{1B}[31mfoo\u{1B}[39m\u{1B}[22m\u{1B}[39m');
});

test('theme names work on instances created before registration', t => {
	const instance = new Chalk({level: 1});
	chalk.defineTheme('later', chalk.magenta);
	t.is(instance.later('foo'), '\u{1B}[35mfoo\u{1B}[39m');
});

test('`hasTheme` returns whether a theme is registered', t => {
	t.false(chalk.hasTheme('mood'));
	chalk.defineTheme('mood', chalk.yellow);
	t.true(chalk.hasTheme('mood'));
});

test('`theme()` applies a theme by name, e.g. a dynamic name', t => {
	chalk.defineTheme('info', chalk.blue);
	const name = 'info';
	t.is(chalk.theme(name)('foo'), '\u{1B}[34mfoo\u{1B}[39m');
});

test('applying an undefined theme via `theme()` throws a helpful error', t => {
	t.throws(() => {
		chalk.theme('does-not-exist');
	}, {
		instanceOf: Error,
		message: 'Chalk theme "does-not-exist" is not defined. Register it first with chalk.defineTheme().',
	});
});

test('`defineTheme` requires a non-empty string name', t => {
	for (const name of ['', 1, null, undefined, {}, ['danger']]) {
		t.throws(() => {
			chalk.defineTheme(name, chalk.red);
		}, {instanceOf: TypeError, message: 'The theme `name` must be a non-empty string.'}, `name: ${JSON.stringify(name)}`);
	}
});

test('`defineTheme` requires a style chain or an `{open, close}` object', t => {
	for (const styler of [undefined, null, 'red', 42, {}, {open: '\u{1B}[31m'}, {close: '\u{1B}[39m'}]) {
		t.throws(() => {
			chalk.defineTheme('invalid', styler);
		}, {instanceOf: TypeError, message: /The theme `styler` must be a Chalk style chain/v}, `styler: ${JSON.stringify(styler)}`);
	}

	t.false(chalk.hasTheme('invalid'));
	t.is(chalk.invalid, undefined);
});

test('theme names cannot conflict with built-in styles or properties', t => {
	for (const name of ['red', 'visible', 'level', 'theme', 'defineTheme', 'hasTheme']) {
		t.throws(() => {
			chalk.defineTheme(name, chalk.red);
		}, {instanceOf: TypeError, message: `The theme name "${name}" is reserved by Chalk.`}, `name: ${name}`);
	}
});

test('themed output respects `level: 0`', t => {
	chalk.defineTheme('quiet', chalk.bold.red);
	const instance = new Chalk({level: 0});
	t.is(instance.quiet('foo'), 'foo');
});

test('redefining a theme overwrites it without throwing', t => {
	chalk.defineTheme('mood', chalk.red);
	t.is(chalk.mood('foo'), '\u{1B}[31mfoo\u{1B}[39m');

	t.notThrows(() => {
		chalk.defineTheme('mood', chalk.blue);
	});

	t.is(chalk.mood('foo'), '\u{1B}[34mfoo\u{1B}[39m');
});

test('the theme registry is shared across instances', t => {
	const instance = new Chalk({level: 1});
	instance.defineTheme('shared', chalk.cyan);
	t.true(chalk.hasTheme('shared'));
	t.is(chalk.shared('foo'), '\u{1B}[36mfoo\u{1B}[39m');
	t.is(instance.shared('foo'), '\u{1B}[36mfoo\u{1B}[39m');
});

test('unregistered theme names are plain missing properties', t => {
	t.is(chalk.doesNotExistAsTheme, undefined);
});
