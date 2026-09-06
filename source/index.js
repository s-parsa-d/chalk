import {
	stringReplaceAll,
	stringEncaseCRLFWithFirstIndex,
} from './utilities.js';
import ansiStyles from '#ansi-styles';
import supportsColor from '#supports-color';

const {stdout: stdoutColor, stderr: stderrColor} = supportsColor;

const GENERATOR = Symbol('GENERATOR');
const STYLER = Symbol('STYLER');
const IS_EMPTY = Symbol('IS_EMPTY');
const LEVEL = Symbol('LEVEL');

const styles = Object.create(null);

// The theme registry is module-level and shared by every instance, including `chalkStderr`, mirroring how the style getters are shared through the common `proto`. Themes are app-wide configuration, usually defined once at startup and consumed wherever any Chalk instance is imported, so per-instance registries would force users to define each theme once per instance.
const themes = new Map();

const assertValidLevel = level => {
	if (!Number.isSafeInteger(level) || level < 0 || level > 3) {
		throw new Error('The `level` should be an integer from 0 to 3');
	}
};

// The level is stored under a symbol so the hot path can read it as a plain property, while `level` itself is an accessor that rejects values the rest of the code could not handle.
const levelDescriptor = {
	enumerable: true,
	get() {
		return this[LEVEL];
	},
	set(level) {
		assertValidLevel(level);
		this[LEVEL] = level;
	},
};

const applyOptions = (object, options = {}) => {
	if (options.level !== undefined) {
		assertValidLevel(options.level);
	}

	// Detect level if not set manually. Written under the symbol rather than through `level`, as the prototype carrying that accessor is not installed until after this runs.
	const colorLevel = stdoutColor ? stdoutColor.level : 0;
	object[LEVEL] = options.level === undefined ? colorLevel : options.level;
};

export class Chalk {
	constructor(options) {
		// eslint-disable-next-line no-constructor-return
		return chalkFactory(options);
	}
}

const chalkFactory = options => {
	const chalk = (...strings) => strings.join(' ');
	applyOptions(chalk, options);

	Object.setPrototypeOf(chalk, createChalk.prototype);

	return chalk;
};

function createChalk(options) {
	return chalkFactory(options);
}

// eslint-disable-next-line unicorn/no-top-level-side-effects -- The prototype chain must be set up at module load.
Object.setPrototypeOf(createChalk.prototype, Function.prototype);

for (const [styleName, style] of Object.entries(ansiStyles)) {
	styles[styleName] = {
		get() {
			const builder = createBuilder(this, createStyler(style.open, style.close, this[STYLER]), this[IS_EMPTY]);
			Object.defineProperty(this, styleName, {value: builder});
			return builder;
		},
	};
}

styles.visible = {
	get() {
		const builder = createBuilder(this, this[STYLER], true);
		Object.defineProperty(this, 'visible', {value: builder});
		return builder;
	},
};

// Resolve a color model to one converter per `level`, so that a call only has to look up the converter for the current level instead of re-deciding the model and level every time.
const createModelConverters = (model, type) => {
	const style = ansiStyles[type];

	if (model === 'rgb') {
		const ansi = (red, green, blue) => style.ansi(ansiStyles.rgbToAnsi(red, green, blue));
		const ansi256 = (red, green, blue) => style.ansi256(ansiStyles.rgbToAnsi256(red, green, blue));
		return [ansi, ansi, ansi256, style.ansi16m];
	}

	if (model === 'hex') {
		const ansi = hex => style.ansi(ansiStyles.hexToAnsi(hex));
		const ansi256 = hex => style.ansi256(ansiStyles.hexToAnsi256(hex));
		return [ansi, ansi, ansi256, hex => style.ansi16m(...ansiStyles.hexToRgb(hex))];
	}

	// `ansi256` is already the native form, so only the 16-color levels need converting.
	const ansi = code => style.ansi(ansiStyles.ansi256ToAnsi(code));
	return [ansi, ansi, style.ansi256, style.ansi256];
};

const usedModels = ['rgb', 'hex', 'ansi256'];

for (const model of usedModels) {
	const capitalizedModel = model[0].toUpperCase() + model.slice(1);

	for (const [styleName, type] of [
		[model, 'color'],
		['bg' + capitalizedModel, 'bgColor'],
		['underline' + capitalizedModel, 'underlineColor'],
	]) {
		const {close} = ansiStyles[type];
		const converters = createModelConverters(model, type);

		styles[styleName] = {
			get() {
				// The level is read on call rather than captured here so the function can be cached on the instance instead of being reallocated on every property access.
				// `rgb` is the widest model, so naming the three parameters avoids a rest array.
				const styleFunction = function (first, second, third) {
					const open = converters[this.level](first, second, third);
					return createBuilder(this, createStyler(open, close, this[STYLER]), this[IS_EMPTY]);
				};

				Object.defineProperty(this, styleName, {value: styleFunction});
				return styleFunction;
			},
		};
	}
}

styles.theme = {
	get() {
		const themeFunction = name => {
			const theme = themes.get(name);

			if (theme === undefined) {
				throw new Error(`Chalk theme "${name}" is not defined. Register it first with chalk.defineTheme().`);
			}

			return createBuilder(this, createStyler(theme.open, theme.close, this[STYLER]), this[IS_EMPTY]);
		};

		Object.defineProperty(this, 'theme', {value: themeFunction});
		return themeFunction;
	},
};

const proto = Object.defineProperties(
	() => {},
	{
		...styles,
		level: {
			enumerable: true,
			get() {
				return this[GENERATOR].level;
			},
			set(level) {
				this[GENERATOR].level = level;
			},
		},
	},
);

const createStyler = (open, close, parent) => {
	let openAll;
	let closeAll;
	if (parent === undefined) {
		openAll = open;
		closeAll = close;
	} else {
		openAll = parent.openAll + open;
		closeAll = close + parent.closeAll;
	}

	return {
		open,
		close,
		openAll,
		closeAll,
		parent,
	};
};

const createBuilder = (self, _styler, _isEmpty) => {
	// Single argument is hot path, implicit coercion is faster than anything
	const builder = (...arguments_) => {
		if (arguments_.length === 1) {
			// eslint-disable-next-line no-implicit-coercion
			return applyStyle(builder, '' + arguments_[0]);
		}

		if (arguments_.length === 2) {
			return applyStyle(builder, arguments_[0] + ' ' + arguments_[1]);
		}

		return applyStyle(builder, arguments_.join(' '));
	};

	// We alter the prototype because we must return a function, but there is
	// no way to create a function with a different prototype
	Object.setPrototypeOf(builder, proto);

	// Point every builder at the root generator instead of its immediate parent, so reading the level costs one property load rather than walking a `level` getter per link of the chain.
	builder[GENERATOR] = self[GENERATOR] ?? self;
	builder[STYLER] = _styler;
	builder[IS_EMPTY] = _isEmpty;

	return builder;
};

const applyStyle = (self, string) => {
	// Read the level directly off the generator to skip the `level` getter dispatch on this hot path
	if (self[GENERATOR][LEVEL] <= 0 || !string) {
		// eslint-disable-next-line unicorn/no-computed-property-existence-check -- Reads the boolean value, not a property existence check.
		return self[IS_EMPTY] ? '' : string;
	}

	let styler = self[STYLER];

	if (styler === undefined) {
		return string;
	}

	const {openAll, closeAll} = styler;
	if (string.includes('\u{1B}')) {
		while (styler !== undefined) {
			// Replace any instances already present with a re-opening code
			// otherwise only the part of the string until said closing code
			// will be colored, and the rest will simply be 'plain'.
			string = stringReplaceAll(string, styler.close, styler.open);

			styler = styler.parent;
		}
	}

	// We can move both next actions out of loop, because remaining actions in loop won't have
	// any/visible effect on parts we add here. Close the styling before a linebreak and reopen
	// after next line to fix a bleed issue on macOS: https://github.com/chalk/chalk/pull/92
	const lfIndex = string.indexOf('\n');
	if (lfIndex !== -1) {
		string = stringEncaseCRLFWithFirstIndex(string, closeAll, openAll, lfIndex);
	}

	return openAll + string + closeAll;
};

// Normalize either accepted shape to the `{open, close}` codes the theme registry stores. A style chain contributes the accumulated codes of the whole chain (`openAll`/`closeAll`), so a theme opens and closes as a single unit, exactly like any raw `{open, close}` theme.
const normalizeThemeStyler = styler => {
	// A Chalk builder is a function carrying the internal styler link, which always holds strings once the chain contains any real style.
	if (typeof styler === 'function' && typeof styler[STYLER]?.openAll === 'string') {
		const {openAll, closeAll} = styler[STYLER];
		return {open: openAll, close: closeAll};
	}

	if (typeof styler === 'object' && styler !== null && typeof styler.open === 'string' && typeof styler.close === 'string') {
		return {open: styler.open, close: styler.close};
	}

	throw new TypeError('The theme `styler` must be a Chalk style chain (e.g. `chalk.bold.red`) or an object with `open` and `close` ANSI escape code strings (e.g. `{open: \'\\u001B[31m\', close: \'\\u001B[39m\'}`).');
};

// Install a getter for the theme name on both shared prototypes, so the name can be used directly like any built-in style (`chalk.danger(...)`, `chalk.danger.bold(...)`). The getter reads the registry on every access instead of caching a builder on the instance, so redefining a theme (last write wins) is observed even after the property has already been used. Themes are never removed, so a previously installed getter for the same name is simply reused.
const installThemeGetter = name => {
	if (themes.has(name)) {
		return;
	}

	for (const object of [proto, createChalk.prototype]) {
		if (Object.hasOwn(object, name)) {
			throw new TypeError(`The theme name "${name}" is reserved by Chalk.`);
		}
	}

	const descriptor = {
		get() {
			const {open, close} = themes.get(name);
			return createBuilder(this, createStyler(open, close, this[STYLER]), this[IS_EMPTY]);
		},
	};

	Object.defineProperty(proto, name, descriptor);
	Object.defineProperty(createChalk.prototype, name, descriptor);
};

const defineTheme = (name, styler) => {
	if (typeof name !== 'string' || name === '') {
		throw new TypeError('The theme `name` must be a non-empty string.');
	}

	// Normalize first so an invalid styler cannot leave a half-registered theme behind.
	const theme = normalizeThemeStyler(styler);
	installThemeGetter(name);

	// Redefining an existing theme name overwrites it (last write wins).
	themes.set(name, theme);
};

const hasTheme = name => themes.has(name);

// `level` lives on the prototype rather than on each instance, so it costs nothing to construct an instance and matches how builders already expose it. It is inherited rather than own, so it does not show up in `Object.keys()`, same as for a builder.
// eslint-disable-next-line unicorn/no-top-level-side-effects -- The style getters must be installed at module load.
Object.defineProperties(createChalk.prototype, {
	...styles,
	level: levelDescriptor,
	defineTheme: {value: defineTheme},
	hasTheme: {value: hasTheme},
});

const chalk = createChalk();
export const chalkStderr = createChalk({level: stderrColor ? stderrColor.level : 0});

export {
	modifierNames,
	foregroundColorNames,
	backgroundColorNames,
	underlineColorNames,
	colorNames,

	// TODO: Remove these aliases in the next major version
	modifierNames as modifiers,
	foregroundColorNames as foregroundColors,
	backgroundColorNames as backgroundColors,
	colorNames as colors,
} from './vendor/ansi-styles/index.js';

export {
	stdoutColor as supportsColor,
	stderrColor as supportsColorStderr,
};

export default chalk;
