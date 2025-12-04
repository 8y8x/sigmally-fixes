// ==UserScript==
// @name         Sigmally Fixes V2
// @version      2.8.0-BETA
// @description  Easily 10X your FPS on Sigmally.com + many bug fixes + great for multiboxing + supports SigMod
// @author       8y8x
// @match        https://*.sigmally.com/*
// @license      MIT
// @icon         https://raw.githubusercontent.com/8y8x/sigmally-fixes/refs/heads/main/icon.png
// @compatible   chrome
// @compatible   opera
// @compatible   edge
// ==/UserScript==

// @ts-check
/* eslint
	camelcase: 'error',
	comma-dangle: ['error', 'always-multiline'],
	indent: ['error', 'tab', { SwitchCase: 1 }],
	max-len: ['error', { code: 120 }],
	no-console: ['error', { allow: ['warn', 'error'] }],
	no-trailing-spaces: 'error',
	quotes: ['error', 'single'],
	semi: 'error',
*/ // a light eslint configuration that doesn't compromise code quality
'use strict';

(() => {
	const sfVersion = '2.8.0-BETA';
	const { Infinity, undefined } = window; // yes, this actually makes a significant difference

	////////////////////////////////
	// Define Auxiliary Functions //
	////////////////////////////////
	const aux = (() => {
		const aux = {};

		/** @type {Map<string, string>} */
		aux.clans = new Map();
		const fetchClans = () => {
			fetch('https://sigmally.com/api/clans').then(r => r.json()).then(r => {
				if (r.status !== 'success') return setTimeout(fetchClans, 10_000);
				for (const clan of r.data) aux.clans.set(clan._id || '', clan.name || '');
				// does not need to be updated often, but just enough so people who leave their tab open don't miss out
				setTimeout(() => fetchClans(), 600_000);
			}).catch(() => setTimeout(fetchClans, 10_000));
		}
		fetchClans();

		/**
		 * @template T
		 * @param {T} x
		 * @param {string} err should be readable and easily translatable
		 * @returns {T extends (null | undefined | false | 0) ? never : T}
		 */
		aux.require = (x, err) => {
			if (!x) {
				prompt('[Sigmally Fixes]: ' + err, err); // use prompt, so people can paste the error message into google translate
				throw '[Sigmally Fixes]: ' + err;
			}

			return /** @type {any} */ (x);
		};

		const dominantColorCtx = aux.require(
			document.createElement('canvas').getContext('2d', { willReadFrequently: true }),
			'Unable to get 2D context for aux utilities. This is probably your browser being dumb, maybe reload ' +
			'the page?',
		);
		/**
		 * @param {HTMLImageElement} img
		 * @returns {[number, number, number, number]}
		 */
		aux.dominantColor = img => {
			dominantColorCtx.canvas.width = dominantColorCtx.canvas.height = 7;
			dominantColorCtx.drawImage(img, 0, 0, 7, 7);
			const data = dominantColorCtx.getImageData(0, 0, 7, 7);

			const r = [], g = [], b = [];
			let sumA = 0, numA = 0;
			for (let x = 0; x < 7; ++x) {
				for (let y = 0; y < 7; ++y) {
					const d2 = (3 - x) * (3 - x) + (3 - y) * (3 - y);
					if (d2 > 3 * 3) continue; // do not consider pixels outside a circle, as they may be blank
					const pixel = y * 7 + x;
					r.push(data.data[pixel * 4]);
					g.push(data.data[pixel * 4 + 1]);
					b.push(data.data[pixel * 4 + 2]);
					sumA += data.data[pixel * 4 + 3];
					++numA;
				}
			}

			r.sort();
			g.sort();
			b.sort();
			/** @type {[number, number, number, number]} */
			const color = [r[Math.ceil(r.length / 2)], g[Math.ceil(g.length / 2)], b[Math.ceil(b.length / 2)], 1];
			color[3] = (sumA / numA / 255) ** 4; // transparent skins should use the player color

			const max = Math.max(color[0], color[1], color[2]);
			if (max === 0) {
				color[0] = color[1] = color[2] = 1;
			} else {
				color[0] /= max;
				color[1] /= max;
				color[2] /= max;
			}

			return color;
		};

		/**
		 * consistent exponential easing relative to 60fps. this models "x += (targetX - x) * dt" scenarios.
		 * for example, with a factor of 2, o=0, n=1:
		 * - at 60fps, 0.5 is returned.
		 * - at 30fps (after 2 frames), 0.75 is returned.
		 * - at 15fps (after 4 frames), 0.875 is returned.
		 * - at 120fps, 0.292893 is returned. if you called this again with o=0.292893, n=1, you would get 0.5.
		 *
		 * @param {number} o
		 * @param {number} n
		 * @param {number} factor
		 * @param {number} dt in seconds
		 */
		aux.exponentialEase = (o, n, factor, dt) => {
			return o + (n - o) * (1 - (1 - 1 / factor) ** (60 * dt));
		};

		/** @param {KeyboardEvent | MouseEvent} e */
		aux.keybind = e => {
			if (!e.isTrusted) return undefined; // custom key events are usually missing properties

			if (e instanceof KeyboardEvent) {
				let keybind = e.key;
				keybind = keybind[0].toUpperCase() + keybind.slice(1); // capitalize first letter (e.g. Shift, R, /, ...)
				if (keybind === '+') keybind = '='; // ensure + can be used to split up keybinds
				if (e.ctrlKey) keybind = 'Ctrl+' + keybind;
				if (e.altKey) keybind = 'Alt+' + keybind;
				if (e.metaKey) keybind = 'Cmd+' + keybind;
				if (e.shiftKey) keybind = 'Shift' + keybind;
				return keybind;
			} else {
				return `Mouse${e.button}`;
			}
		};

		/**
		 * @param {string} hex
		 * @returns {[number, number, number, number]}
		 */
		aux.hex2rgba = hex => {
			switch (hex.length) {
				case 4: // #rgb
				case 5: // #rgba
					return [
						(parseInt(hex[1], 16) || 0) / 15,
						(parseInt(hex[2], 16) || 0) / 15,
						(parseInt(hex[3], 16) || 0) / 15,
						hex.length === 5 ? (parseInt(hex[4], 16) || 0) / 15 : 1,
					];
				case 7: // #rrggbb
				case 9: // #rrggbbaa
					return [
						(parseInt(hex.slice(1, 3), 16) || 0) / 255,
						(parseInt(hex.slice(3, 5), 16) || 0) / 255,
						(parseInt(hex.slice(5, 7), 16) || 0) / 255,
						hex.length === 9 ? (parseInt(hex.slice(7, 9), 16) || 0) / 255 : 1,
					];
				default:
					return [1, 1, 1, 1];
			}
		};

		/**
		 * @param {number} r
		 * @param {number} g
		 * @param {number} b
		 * @param {number} a
		 */
		aux.rgba2hex = (r, g, b, a) => {
			return [
				'#',
				Math.floor(r * 255).toString(16).padStart(2, '0'),
				Math.floor(g * 255).toString(16).padStart(2, '0'),
				Math.floor(b * 255).toString(16).padStart(2, '0'),
				Math.floor(a * 255).toString(16).padStart(2, '0'),
			].join('');
		};

		// i don't feel like making an awkward adjustment to aux.rgba2hex
		/**
		 * @param {number} r
		 * @param {number} g
		 * @param {number} b
		 * @param {any} _a
		 */
		aux.rgba2hex6 = (r, g, b, _a) => {
			return [
				'#',
				Math.floor(r * 255).toString(16).padStart(2, '0'),
				Math.floor(g * 255).toString(16).padStart(2, '0'),
				Math.floor(b * 255).toString(16).padStart(2, '0'),
			].join('');
		};

		/** @param {string} name */
		aux.parseName = name => name.match(/^\{.*?\}(.*)$/)?.[1] ?? name;

		/** @param {string} skin */
		aux.parseSkin = skin => {
			if (!skin) return skin;
			skin = skin.replace('1%', '').replace('2%', '').replace('3%', '');
			return '/static/skins/' + skin + '.png';
		};

		/**
		 * @param {DataView} dat
		 * @param {number} o
		 * @returns {[string, number]}
		 */
		aux.readZTString = (dat, o) => {
			if (dat.getUint8(o) === 0) return ['', o + 1]; // quick return for empty strings (there are a lot)
			const startOff = o;
			for (; o < dat.byteLength; ++o) {
				if (dat.getUint8(o) === 0) break;
			}

			return [aux.textDecoder.decode(new DataView(dat.buffer, startOff, o - startOff)), o + 1];
		};

		/**
		 * @param {string} selector
		 * @param {boolean} value
		 */
		aux.setting = (selector, value) => {
			/** @type {HTMLInputElement | null} */
			const el = document.querySelector(selector);
			return el ? el.checked : value;
		};

		/** @param {boolean} accessSigmod */
		const settings = accessSigmod => {
			try {
				// current skin is saved in localStorage
				aux.settings = JSON.parse(localStorage.getItem('settings') ?? '');
			} catch (_) {
				aux.settings = /** @type {any} */ ({});
			}

			// sigmod doesn't have a checkbox for dark theme, so we infer it from the custom map color
			const { mapColor } = accessSigmod ? sigmod.settings : {};
			if (mapColor) {
				aux.settings.darkTheme
					= mapColor ? (mapColor[0] < 0.6 && mapColor[1] < 0.6 && mapColor[2] < 0.6) : true;
			} else {
				aux.settings.darkTheme = aux.setting('input#darkTheme', true);
			}
			aux.settings.jellyPhysics = aux.setting('input#jellyPhysics', false);
			aux.settings.showBorder = aux.setting('input#showBorder', true);
			aux.settings.showClanmates = aux.setting('input#showClanmates', true);
			aux.settings.showGrid = aux.setting('input#showGrid', true);
			aux.settings.showMass = aux.setting('input#showMass', false);
			aux.settings.showMinimap = aux.setting('input#showMinimap', true);
			aux.settings.showSkins = aux.setting('input#showSkins', true);
			aux.settings.zoomout = aux.setting('input#moreZoom', true);
			return aux.settings;
		};

		/** @type {{ darkTheme: boolean, jellyPhysics: boolean, showBorder: boolean, showClanmates: boolean,
		 showGrid: boolean, showMass: boolean, showMinimap: boolean, showSkins: boolean, zoomout: boolean,
		 gamemode: any, skin: any }} */
		aux.settings = settings(false);
		setInterval(() => settings(true), 250);
		// apply saved gamemode because sigmally fixes connects before the main game even loads
		if (aux.settings?.gamemode) {
			/** @type {HTMLSelectElement | null} */
			const gamemode = document.querySelector('select#gamemode');
			if (gamemode) gamemode.value = aux.settings.gamemode;
		}

		aux.textEncoder = new TextEncoder();
		aux.textDecoder = new TextDecoder();

		const trimCtx = aux.require(
			document.createElement('canvas').getContext('2d'),
			'Unable to get 2D context for text utilities. This is probably your browser being dumb, maybe reload ' +
			'the page?',
		);
		trimCtx.font = '20px Ubuntu';
		/**
		 * trims text to a max of 250px at 20px font, same as vanilla sigmally
		 * @param {string} text
		 */
		aux.trim = text => {
			while (trimCtx.measureText(text).width > 250) text = text.slice(0, -1);
			return text;
		};

		// @ts-expect-error
		let handler = window.signOut;
		Object.defineProperty(window, 'signOut', {
			get: () => () => {
				aux.userData = undefined;
				return handler?.();
			},
			set: x => handler = x,
		});

		/** @type {object | undefined} */
		aux.userData = undefined;
		aux.oldFetch = /** @type {typeof fetch} */ (fetch.bind(window));
		Object.defineProperty(window, 'fetch', {
			value: function(url, data, ...args) {
				const urlString = String(url);
				console.log(url);
				// block game.js from attempting to go through captcha flow
				if (urlString.includes('/server/recaptcha/v3')) return new Promise(() => {});
				// game.js doesn't think we're connected to a server, we default to eu0 because that's the
				// default everywhere else
				if (urlString.includes('/userdata/')) url = urlString.replace('///', '//eu0.sigmally.com/server/');
				// sigmod must be properly initialized (client can't be null), otherwise it will error
				// and game.js will never get the account data
				if (urlString.includes('/server/auth')) sigmod.patch();

				return aux.oldFetch(url, data, ...args).then(res => Object.defineProperty(res, 'json', {
					value: () => Response.prototype.json.call(res).then(obj => {
						if (obj?.body?.user) aux.userData = obj.body.user;
						return obj;
					}),
				}));
			},
		});

		// get the latest game.js version whenever possible (in the past, players could not log in on an older game.js)
		fetch('https://one.sigmally.com/assets/js/game.js', { cache: 'reload' });
		// clicking "continue" immediately makes a request for user data, so we can get it even if sigfixes runs late
		/** @type {HTMLButtonElement | null} */ (document.querySelector('#continue_button'))?.click();

		return aux;
	})();



	////////////////////////
	// Destroy Old Client //
	////////////////////////
	(() => {
		const vanillaStack = () => {
			try {
				throw new Error();
			} catch (err) {
				// prevent drawing the game, but do NOT prevent saving settings (which is called on RQA)
				return err.stack.includes('/game.js') && !err.stack.includes('HTML');
			}
		};

		// #1 : kill the rendering process
		const oldRQA = requestAnimationFrame;
		window.requestAnimationFrame = fn => vanillaStack() ? -1 : oldRQA(fn);

		// #2 : kill access to using a WebSocket
		window.WebSocket = new Proxy(WebSocket, {
			construct(target, args) {
				if (args[0].includes('sigmally.com') && vanillaStack())
					throw new Error('[Sigmally Fixes]: Preventing new WebSocket() for unknown Sigmally connection');
				
				return new target(...args);
			}
		});

		const oldWsSend = WebSocket.prototype.send;
		WebSocket.prototype.send = function(x) {
			if (vanillaStack() && this.url.includes('sigmally.com')) {
				this.onclose = null; // prevent automatic reconnect
				this.close();
				throw new Error('[Sigmally Fixes]: Preventing WebSocket.prototype.send on unknown Sigmally connection');
			}

			return oldWsSend.call(this, x);
		}

		// #3 : prevent keys from being registered by the vanilla game
		setInterval(() => onkeydown = onkeyup = null, 200);
	})();



	//////////////////////////////////
	// Apply Complex SigMod Patches //
	//////////////////////////////////
	const sigmod = (() => {
		const sigmod = {};

		/** @type {{
		 * 	cellColor?: [number, number, number, number],
		 * 	doubleKey?: string,
		 * 	fixedLineKey?: string,
		 * 	foodColor?: [number, number, number, number],
		 * 	font?: string,
		 * 	horizontalLineKey?: string,
		 * 	mapColor?: [number, number, number, number],
		 * 	nameColor1?: [number, number, number, number],
		 * 	nameColor2?: [number, number, number, number],
		 * 	outlineColor?: [number, number, number, number],
		 * 	quadKey?: string,
		 * 	rapidFeedKey?: string,
		 * 	removeOutlines?: boolean,
		 * 	respawnKey?: string,
		 * 	showNames?: boolean,
		 * 	tripleKey?: string,
		 * 	verticalLineKey?: string,
		 * 	virusImage?: string,
		 * }} */
		sigmod.settings = {};
		/** @type {Set<string>} */
		const loadedFonts = new Set();
		setInterval(() => {
			// @ts-expect-error
			const real = window.sigmod?.settings;
			if (!real) return;
			sigmod.exists = true;

			const applyColor = (prop, initial, lookups) => {
				for (const lookup of lookups) {
					if (lookup && lookup !== initial) {
						sigmod.settings[prop] = aux.hex2rgba(lookup);
						return;
					}
				}
				sigmod.settings[prop] = undefined;
			};
			applyColor('cellColor', null, [real.game?.cellColor]);
			applyColor('foodColor', null, [real.game?.foodColor]);
			applyColor('mapColor', null, [real.game?.map?.color, real.mapColor]);
			// note: singular nameColor takes priority
			const name = real.game?.name;
			applyColor('nameColor1', '#ffffff', [name?.color, name?.gradient?.enabled && name.gradient.left]);
			applyColor('nameColor2', '#ffffff', [name?.color, name?.gradient?.enabled && name.gradient.right]);
			// sigmod treats the map border as cell borders for some reason
			applyColor('outlineColor', '#0000ff', [real.game?.borderColor]);
			sigmod.settings.removeOutlines = real.game?.removeOutlines;
			sigmod.settings.virusImage = real.game?.virusImage;
			sigmod.settings.rapidFeedKey = real.macros?.keys?.rapidFeed;
			// sigmod's showNames setting is always "true" interally (i think??)
			sigmod.settings.showNames = aux.setting('input#showNames', true);

			sigmod.settings.font = real.game?.font;

			// sigmod does not download the bold variants of fonts, so we have to do that ourselves
			if (sigmod.settings.font && !loadedFonts.has(sigmod.settings.font)) {
				loadedFonts.add(sigmod.settings.font);
				const link = document.createElement('link');
				link.href = `https://fonts.googleapis.com/css2?family=${sigmod.settings.font}:wght@700&display=swap`;
				link.rel = 'stylesheet';
				document.head.appendChild(link);
			}
		}, 200);

		// patch sigmod when it's ready; typically sigmod loads first, but i can't guarantee that
		sigmod.exists = false;
		/** @type {((dat: DataView) => void) | undefined} */
		sigmod.handleMessage = undefined;
		let patchInterval;
		sigmod.patch = () => {
			const real = /** @type {any} */ (window).sigmod;
			if (!real || patchInterval === undefined) return;
			sigmod.exists = true;

			clearInterval(patchInterval);
			patchInterval = undefined;

			// anchor chat and minimap to the screen, so scrolling to zoom doesn't move them
			// it's possible that cursed will change something at any time so i'm being safe here
			const minimapContainer = /** @type {HTMLElement | null} */ (document.querySelector('.minimapContainer'));
			if (minimapContainer) minimapContainer.style.position = 'fixed';
			const modChat = /** @type {HTMLElement | null} */ (document.querySelector('.modChat'));
			if (modChat) modChat.style.position = 'fixed';

			// sigmod keeps track of the # of displayed messages with a counter, but it doesn't reset on clear
			// therefore, if the chat gets cleared with 200 (the maximum) messages in it, it will stay permanently*
			// blank
			const modMessages = /** @type {HTMLElement | null} */ (document.querySelector('#mod-messages'));
			if (modMessages) {
				const old = modMessages.removeChild;
				modMessages.removeChild = node => {
					if (modMessages.children.length > 200) return old.call(modMessages, node);
					else return node;
				};
			}

			// disable all keys on sigmod's end and enable them here
			/** @param {keyof typeof sigmod.settings} key */
			const getset = key => ({
				// toJSON and toString are implemented so that the key still displays and saves properly,
				// while returning an object that would never match anything in a keydown event
				get: () => ({ toJSON: () => sigmod.settings[key], toString: () => sigmod.settings[key] }),
				set: x => sigmod.settings[key] = x,
			});
			const keys = real.settings?.macros?.keys;
			if (keys) {
				sigmod.settings.respawnKey = keys.respawn;
				Object.defineProperty(keys, 'respawn', getset('respawnKey'));

				if (keys.line) {
					sigmod.settings.horizontalLineKey = keys.line.horizontal;
					sigmod.settings.verticalLineKey = keys.line.vertical;
					sigmod.settings.fixedLineKey = keys.line.fixed;
					Object.defineProperties(keys.line, {
						horizontal: getset('horizontalLineKey'),
						vertical: getset('verticalLineKey'),
						fixed: getset('fixedLineKey'),
					});
				}

				if (keys.splits) {
					sigmod.settings.doubleKey = keys.splits.double;
					sigmod.settings.tripleKey = keys.splits.triple;
					sigmod.settings.quadKey = keys.splits.quad;
					Object.defineProperties(keys.splits, {
						double: getset('doubleKey'),
						triple: getset('tripleKey'),
						quad: getset('quadKey'),
					});
				}
			}

			// create a fake sigmally proxy for sigmod, which properly relays some packets (because SigMod does not
			// support one-tab technology). it should also fix chat bugs due to disconnects and stuff
			// we do this by hooking into the SigWsHandler object
			{
				/** @type {object | undefined} */
				let handler;
				const old = Function.prototype.bind;
				Function.prototype.bind = function(obj) {
					if (obj.constructor?.name === 'SigWsHandler') handler = obj;
					return old.call(this, obj);
				};
				new WebSocket('wss://255.255.255.255/sigmally.com?sigfix');
				Function.prototype.bind = old;
				// handler is expected to be a "SigWsHandler", but it might be something totally different
				if (!(handler && 'sendPacket' in handler) && !('handleMessage' in handler)) return;
				// first, set up the handshake (opcode not-really-a-shuffle)
				// handshake is reset to false on close (which may or may not happen immediately)
				Object.defineProperty(handler, 'handshake', { get: () => true, set: () => {} });
				handler.R = handler.C = new Uint8Array(256); // R and C are linked
				for (let i = 0; i < 256; ++i) handler.C[i] = i;

				sigmod.handleMessage = dat => handler.handleMessage({ data: dat.buffer });
			}
		};
		patchInterval = setInterval(sigmod.patch, 500);
		sigmod.patch();

		return sigmod;
	})();



	/////////////////////////
	// Create Options Menu //
	/////////////////////////
	const settings = (() => {
		const settings = {
			autoZoom: true,
			background: '',
			blockBrowserKeybinds: false,
			blockNearbyRespawns: false,
			boldUi: false,
			/** @type {'natural' | 'default'} */
			camera: 'default',
			/** @type {'default' | 'instant'} */
			cameraMovement: 'default',
			cameraSmoothness: 2,
			cameraSpawnAnimation: true,
			cellGlow: false,
			cellOpacity: 1,
			cellOutlines: true,
			clans: false,
			clanScaleFactor: 1,
			colorUnderSkin: true,
			delayDouble: false,
			drawDelay: 120,
			jellySkinLag: true,
			massBold: false,
			massOpacity: 1,
			massScaleFactor: 1,
			mergeCamera: true,
			moveAfterLinesplit: false,
			multibox: '',
			/** @type {string[]} */
			multiNames: [],
			nameBold: false,
			nameScaleFactor: 1,
			nbox: false,
			nboxCount: 3,
			nboxCyclePair: '',
			nboxHoldKeybinds: ['', '', '', '', '', '', '', ''],
			nboxSelectKeybinds: ['', '', '', '', '', '', '', ''],
			nboxSwitchPair: '',
			outlineMulti: 0.2,
			// delta's default colors, #ff00aa and #ffffff
			outlineMultiColor: /** @type {[number, number, number, number]} */ ([1, 0, 2/3, 1]),
			outlineMultiInactiveColor: /** @type {[number, number, number, number]} */ ([1, 1, 1, 1]),
			pelletGlow: false,
			rainbowBorder: false,
			scrollFactor: 1,
			selfSkin: '',
			selfSkinMulti: '',
			selfSkinNbox: ['', '', '', '', '', ''],
			slowerJellyPhysics: false,
			separateBoost: false,
			showStats: true,
			spectator: false,
			spectatorLatency: false,
			/** @type {'' | 'latest' | 'flawless'} */
			synchronization: 'flawless',
			textOutlinesFactor: 1,
			// default is the default chat color
			theme: /** @type {[number, number, number, number]} */ ([252 / 255, 114 / 255, 0, 0]),
			tracer: false,
			unsplittableColor: /** @type {[number, number, number, number]} */ ([1, 1, 1, 1]),
		};

		const settingsExt = {};
		Object.setPrototypeOf(settings, settingsExt);

		try {
			Object.assign(settings, JSON.parse(localStorage.getItem('sigfix') ?? ''));
		} catch (_) { }

		// convert old settings
		{
			if (/** @type {any} */ (settings.multibox) === true) settings.multibox = 'Tab';
			else if (/** @type {any} */ (settings.multibox) === false) settings.multibox = '';

			if (/** @type {any} */ (settings).unsplittableOpacity !== undefined) {
				settings.unsplittableColor = [1, 1, 1, /** @type {any} */ (settings).unsplittableOpacity];
				delete settings.unsplittableOpacity;
			}

			const { autoZoom, multiCamera, synchronization } = /** @type {any} */ (settings);
			if (multiCamera !== undefined) {
				if (multiCamera === 'natural' || multiCamera === 'delta' || multiCamera === 'weighted') {
					settings.camera = 'natural';
				} else if (multiCamera === 'none') settings.camera = 'default';

				settings.mergeCamera = multiCamera !== 'weighted' && multiCamera !== 'none'; // the two-tab settings
				delete settings.multiCamera;
			}

			if (autoZoom === 'auto') settings.autoZoom = true;
			else if (autoZoom === 'never') settings.autoZoom = false;

			// accidentally set the default to 'none' which sucks
			if (synchronization === 'none') settings.synchronization = 'flawless';
		}

		/** @type {(() => void)[]} */
		const onSyncs = [];
		/** @type {(() => void)[]} */
		const onUpdates = [];

		settingsExt.refresh = () => {
			onSyncs.forEach(fn => fn());
			onUpdates.forEach(fn => fn());
		};

		// allow syncing sigfixes settings in case you leave an extra sig tab open for a long time and would lose your
		// changed settings
		const channel = new BroadcastChannel('sigfix-settings');
		channel.addEventListener('message', msg => {
			Object.assign(settings, msg.data);
			settingsExt.refresh();
		});

		/** @type {IDBDatabase | undefined} */
		settingsExt.database = undefined;
		const dbReq = indexedDB.open('sigfix', 1);
		dbReq.addEventListener('success', () => void (settingsExt.database = dbReq.result));
		dbReq.addEventListener('upgradeneeded', () => {
			settingsExt.database = dbReq.result;
			settingsExt.database.createObjectStore('images');
		});

		// #1 : define helper functions
		/**
		 * @param {string} html
		 * @returns {HTMLElement}
		 */
		function fromHTML(html) {
			const div = document.createElement('div');
			div.innerHTML = html;
			return /** @type {HTMLElement} */ (div.firstElementChild);
		}

		settingsExt.save = () => {
			localStorage.setItem('sigfix', JSON.stringify(settings));
			channel.postMessage(settings);
			onUpdates.forEach(fn => fn());
		}

		/**
		 * @template O, T
		 * @typedef {{ [K in keyof O]: O[K] extends T ? K : never }[keyof O]} PropertyOfType
		 */

		/** @type {HTMLElement | null} */
		const vanillaModal = document.querySelector('#cm_modal__settings .ctrl-modal__modal');
		if (vanillaModal) vanillaModal.style.width = '440px'; // make modal wider to fit everything properly

		const vanillaMenu = document.querySelector('#cm_modal__settings .ctrl-modal__content');
		vanillaMenu?.appendChild(fromHTML(`<div class="menu__item">
			<div style="width: 100%; height: 1px; background: #bfbfbf;"></div>
		</div>`));

		/**
		 * @template T
		 * @param {T | null} el
		 * @returns {T}
		 */
		const require = el => /** @type {T} */ (el); // aux.require is unnecessary for requiring our own elements

		const vanillaContainer = document.createElement('div');
		vanillaContainer.className = 'menu__item';
		vanillaMenu?.appendChild(vanillaContainer);

		const sigmodContainer = document.createElement('div');
		sigmodContainer.className = 'mod_tab scroll';
		sigmodContainer.style.display = 'none';

		/** @type {{ container: HTMLElement, help: HTMLElement, helpbox: HTMLElement }[]} */
		const containers = [];

		/**
		 * @param {string} title
		 * @param {{ sigmod: HTMLElement, vanilla: HTMLElement }[]} components
		 * @param {() => boolean} show
		 * @param {string} help
		*/
		const setting = (title, components, show, help) => {
			const vanilla = fromHTML(`<div style="height: 25px; position: relative;">
				<div style="height: 25px; line-height: 25px; position: absolute; top: 0; left: 0;">
					<a id="sf-help" style="color: #0009; cursor: help; user-select: none;">(?)</a> ${title}
				</div>
				<div id="sf-components" style="height: 25px; margin-left: 5px; position: absolute; right: 0;
					bottom: 0;"></div>
				<div id="sf-helpbox" style="display: none; position: absolute; top: calc(100% + 5px); left: 20px;
					width: calc(100% - 30px); height: fit-content; padding: 10px; color: #000; background: #fff;
					border: 1px solid #999; border-radius: 4px; z-index: 2;">${help}</div>
			</div>`);
			const sigmod = fromHTML(`<div class="modRowItems justify-sb" style="padding: 5px 10px; position: relative;">
				<span><a id="sfsm-help" style="color: #fff9; cursor: help; user-select: none;">(?)</a> ${title}</span>
				<span class="justify-sb" id="sfsm-components"></span>
				<div id="sfsm-helpbox" style="display: none; position: absolute; top: calc(100% + 5px); left: 30px;
					width: calc(100% - 40px); height: fit-content; padding: 10px; color: #fffe; background: #000;
					border: 1px solid #6871f1; border-radius: 4px; z-index: 2;">${help}</div>
			</div>`);

			const vanillaComponents = require(vanilla.querySelector('#sf-components'));
			const sigmodComponents = require(sigmod.querySelector('#sfsm-components'));
			for (const pair of components) {
				vanillaComponents.appendChild(pair.vanilla);
				sigmodComponents.appendChild(pair.sigmod);
			}

			const reshow = () => void (vanilla.style.display = sigmod.style.display = show() ? '' : 'none');
			reshow();
			onUpdates.push(reshow);

			vanillaContainer.appendChild(vanilla);
			sigmodContainer.appendChild(sigmod);
			containers.push({
				container: vanilla,
				help: require(vanilla.querySelector('#sf-help')),
				helpbox: require(vanilla.querySelector('#sf-helpbox')),
			}, {
				container: sigmod,
				help: require(sigmod.querySelector('#sfsm-help')),
				helpbox: require(sigmod.querySelector('#sfsm-helpbox')),
			});
		};

		/**
		 * @param {PropertyOfType<typeof settings, number>} property
		 * @param {number} initial
		 * @param {number} min
		 * @param {number} max
		 * @param {number} step
		 * @param {number} decimals
		 */
		const slider = (property, initial, min, max, step, decimals) => {
			const listen = (slider, display) => {
				const change = () => slider.value = display.value = settings[property].toFixed(decimals);
				onSyncs.push(change);
				change();

				const onInput = input => {
					const value = Number(input.value);
					if (Number.isNaN(value)) return;

					settings[property] = value;
					change();
					settingsExt.save();
				};
				slider.addEventListener('input', () => onInput(slider));
				display.addEventListener('change', () => onInput(display));
			};

			const datalist = `<datalist id="sf-${property}-markers"> <option value="${initial}"></option> </datalist>`;
			const vanilla = fromHTML(`<div>
				<input id="sf-${property}" style="display: block; float: left; height: 25px; line-height: 25px;
					margin-left: 5px;" min="${min}" max="${max}" step="${step}" value="${initial}"
					list="sf-${property}-markers" type="range" />
				${initial !== undefined ? datalist : ''}
				<input id="sf-${property}-display" style="display: block; float: left; height: 25px;
					line-height: 25px; width: 50px; text-align: center; margin-left: 5px;" />
			</div>`);
			const sigmod = fromHTML(`<span class="justify-sb">
				<input id="sfsm-${property}" style="width: 200px;" type="range" min="${min}" max="${max}"
					step="${step}" value="${initial}" list="sf-${property}-markers" />
				${initial !== undefined ? datalist : ''}
				<input id="sfsm-${property}-display" class="text-center form-control" style="border: none;
					width: 50px; margin: 0 15px;" />
			</span>`);

			listen(require(vanilla.querySelector(`#sf-${property}`)),
				require(vanilla.querySelector(`#sf-${property}-display`)));
			listen(require(sigmod.querySelector(`#sfsm-${property}`)),
				require(sigmod.querySelector(`#sfsm-${property}-display`)));
			return { sigmod, vanilla };
		};

		/** @param {PropertyOfType<typeof settings, boolean>} property */
		const checkbox = property => {
			/** @param {HTMLInputElement} input */
			const listen = input => {
				onSyncs.push(() => input.checked = settings[property]);
				input.checked = settings[property];

				input.addEventListener('input', () => {
					settings[property] = input.checked;
					settingsExt.save();
				});
			};

			const vanilla = fromHTML(`<input id="sf-${property}" type="checkbox" />`);
			const sigmod = fromHTML(`<div style="margin-right: 25px;">
				<div class="modCheckbox" style="display: inline-block;">
					<input id="sfsm-${property}" type="checkbox" />
					<label class="cbx" for="sfsm-${property}"></label>
				</div>
			</div>`);
			listen(/** @type {HTMLInputElement} */ (vanilla));
			listen(require(sigmod.querySelector(`#sfsm-${property}`)));
			return { sigmod, vanilla };
		};

		/**
		 * @param {any} property
		 * @param {any} parent
		 * @param {string} key
		 */
		const image = (property, parent = settings, key = property) => {
			const listen = (input, isSigmod) => {
				onSyncs.push(() => input.value = parent[property]);
				input.value = parent[property];

				input.addEventListener('input', e => {
					if (input.value.startsWith('🖼️')) {
						input.value = parent[property];
						e.preventDefault();
						return;
					}

					/** @type {string} */ (parent[property]) = input.value;
					settingsExt.save();
				});
				input.addEventListener('dragenter', () => void (input.style.borderColor = '#00ccff'));
				input.addEventListener('dragleave',
					() => void (input.style.borderColor = isSigmod ? 'transparent' : ''));
				input.addEventListener('drop', e => {
					input.style.borderColor = isSigmod ? 'transparent' : '';
					e.preventDefault();

					const file = e.dataTransfer?.files[0];
					const { database } = settingsExt;
					if (!file || !database) return;

					input.value = '(importing)';

					const transaction = database.transaction('images', 'readwrite');
					transaction.objectStore('images').put(file, key);

					transaction.addEventListener('complete', () => {
						/** @type {string} */ (parent[property]) = input.value = `🖼️ ${file.name}`;
						settingsExt.save();
						render.resetDatabaseCache();
					});
					transaction.addEventListener('error', err => {
						input.value = '(failed to load image)';
						console.warn('sigfix database error:', err);
					});
				});
			};

			const placeholder = 'https://i.imgur.com/... or drag here';
			const vanilla = fromHTML(`<input id="sf-${property}" placeholder="${placeholder}" type="text" />`);
			const sigmod = fromHTML(`<input class="modInput" id="sfsm-${property}" placeholder="${placeholder}"
				style="border: 1px solid transparent; width: 250px;" type="text" />`);
			listen(/** @type {HTMLInputElement} */ (vanilla), false);
			listen(/** @type {HTMLInputElement} */ (sigmod), true);
			return { sigmod, vanilla };
		};

		/** @param {PropertyOfType<typeof settings, [number, number, number, number]>} property */
		const color = (property, toggle = false) => {
			const listen = (input, alpha) => {
				const update = () => {
					input.value = aux.rgba2hex6(...settings[property]);
					if (toggle) alpha.checked = settings[property][3] > 0;
					else alpha.value = String(settings[property][3]);
				};
				onSyncs.push(update);
				update();

				const changed = () => {
					settings[property] = aux.hex2rgba(input.value);
					if (toggle) settings[property][3] = alpha.checked ? 1 : 0;
					else settings[property][3] = Number(alpha.value);
					settingsExt.save();
				};
				input.addEventListener('input', changed);
				alpha.addEventListener('input', changed);
			};

			const vanilla = fromHTML(`<div>
				<input id="sf-${property}-alpha" type="${toggle ? 'checkbox' : 'range'}" min="0" max="1" \
					step="0.01" ${toggle ? '' : 'style="width: 100px;"'} />
				<input id="sf-${property}" type="color" />
			</div>`);
			const sigmod = fromHTML(`<div style="margin-right: 25px;">
				${toggle ? `<div class="modCheckbox" style="display: inline-block;">
					<input id="sfsm-${property}-alpha" type="checkbox" />
					<label class="cbx" for="sfsm-${property}-alpha"></label>
				</div>` : `<input id="sfsm-${property}-alpha" type="range" min="0" max="1" step="0.01" \
					style="width: 100px" />`}
				<input id="sfsm-${property}" type="color" />
			</div>`);
			listen(require(vanilla.querySelector(`#sf-${property}`)),
				require(vanilla.querySelector(`#sf-${property}-alpha`)));
			listen(require(sigmod.querySelector(`#sfsm-${property}`)),
				require(sigmod.querySelector(`#sfsm-${property}-alpha`)));
			return { sigmod, vanilla };
		};

		/**
		 * @param {PropertyOfType<typeof settings, string>} property
		 * @param {[string, string][]} options
		 */
		const dropdown = (property, options) => {
			const listen = input => {
				onSyncs.push(() => input.value = settings[property]);
				input.value = settings[property];

				input.addEventListener('input', () => {
					/** @type {string} */ (settings[property]) = input.value;
					settingsExt.save();
				});
			};

			const vanilla = fromHTML(`\<select id="sf-${property}">
				${options.map(([value, name]) => `<option value="${value}">${name}</option>`).join('\n')}
			</select>`);
			const sigmod = fromHTML(`<select class="form-control" id="sfsm-${property}" style="width: 250px;">
				${options.map(([value, name]) => `<option value="${value}">${name}</option>`).join('\n')}
			</select>`);
			listen(/** @type {HTMLSelectElement} */ (vanilla));
			listen(/** @type {HTMLSelectElement} */ (sigmod));
			return { sigmod, vanilla };
		};

		/**
		 * @param {any} property
		 * @param {any} parent
		 */
		const keybind = (property, parent = settings) => {
			/** @param {HTMLInputElement} input */
			const listen = input => {
				onSyncs.push(() => input.value = parent[property]);
				input.value = parent[property];

				input.addEventListener('keydown', e => {
					if (e.key === 'Control' || e.key === 'Alt' || e.key === 'Meta') return;
					if (e.code === 'Escape' || e.code === 'Backspace') {
						parent[property] = input.value = '';
					} else {
						parent[property] = input.value = aux.keybind(e) ?? '';
					}
					settingsExt.save();
					e.preventDefault(); // prevent the key being typed in
				});
				input.addEventListener('mousedown', e => {
					if (e.button === 0 && document.activeElement !== input) return; // do default action
					parent[property] = input.value = aux.keybind(e) ?? '';
					settingsExt.save();
					e.preventDefault();
				});
				input.addEventListener('contextmenu', e => void e.preventDefault());
			};

			const vanilla = fromHTML(`<input id="sf-${property}" placeholder="..." type="text" style="
				text-align: center; width: 80px;" />`);
			const sigmod = fromHTML(`<input class="keybinding" id="sfsm-${property}" placeholder="..."
				style="max-width: 100px; width: 100px;" type="text" />`);
			listen(/** @type {HTMLInputElement} */ (vanilla));
			listen(/** @type {HTMLInputElement} */ (sigmod));
			return { sigmod, vanilla };
		};

		addEventListener('mousedown', ev => {
			for (const { container, help, helpbox } of containers) {
				if (container.contains(/** @type {Node | null} */ (ev.target))) {
					if (ev.target === help) helpbox.style.display = '';
				} else {
					if (helpbox.style.display === '') helpbox.style.display = 'none';
				}
			}
		});

		const separator = (text = '•') => {
			vanillaContainer.appendChild(fromHTML(`<div style="text-align: center; width: 100%;">${text}</div>`));
			sigmodContainer.appendChild(fromHTML(`<span class="text-center">${text}</span>`));
		};

		const newTag = `<span style="padding: 2px 5px; border-radius: 10px; background: #76f; color: #fff;
			font-weight: bold; font-size: 0.95rem; user-select: none;">NEW</span>`;

		// #2 : generate ui for settings
		setting('Draw delay', [slider('drawDelay', 120, 40, 300, 1, 0)], () => true,
			'How long (in milliseconds) cells will lag behind for. Lower values mean cells will very quickly catch ' +
			'up to where they actually are.');
		setting('Cell outlines', [checkbox('cellOutlines')], () => true,
			'Whether the subtle dark outlines around cells (including skins) should draw.');
		setting('Cell opacity', [slider('cellOpacity', 1, 0, 1, 0.005, 3)], () => true,
			'How opaque cells should be. 1 = fully visible, 0 = invisible. It can be helpful to see the size of a ' +
			'smaller cell under a big cell.');
		setting('Self skin URL', [image('selfSkin')], () => true,
			'A custom skin for yourself. You can drag+drop a skin here, or use a direct URL. Not visible to others.');
		setting('Secondary skin URL', [image('selfSkinMulti')], () => !!settings.multibox || settings.nbox,
			'A custom skin for your secondary multibox tab. You can drag+drop a skin here, or use a direct URL. Not ' +
			'visible to others.');
		setting('Map background', [image('background')], () => true,
			'A square background image to use within the entire map border. Images 512x512 and under will be treated ' +
			'as a repeating pattern, where 50 pixels = 1 grid square.');
		setting('Lines between cell and mouse', [checkbox('tracer')], () => true,
			'If enabled, draws tracers between all of the cells you ' +
			'control and your mouse. Useful as a hint to your subconscious about which tab you\'re currently on.');

		separator('• camera •');
		setting('Camera style', [dropdown('camera', [['natural', 'Natural (weighted)'], ['default', 'Default']])],
			() => true,
			'How the camera focuses on your cells. <br>' +
			'- A "natural" camera follows your center of mass. If you have a lot of small back pieces, they would ' +
			'barely affect your camera position. <br>' +
			'- The "default" camera focuses on every cell equally. If you have a lot of small back pieces, your ' +
			'camera would focus on those instead. <br>' +
			'When one-tab multiboxing, you <b>must</b> use the Natural (weighted) camera style.');
		setting('Camera movement',
			[dropdown('cameraMovement', [['default', 'Default'], ['instant', 'Instant']])], () => true,
			'How the camera moves. <br>' +
			'- "Default" camera movement follows your cell positions, but when a cell dies or splits, it immediately ' +
			'stops or starts focusing on it. Artificial smoothness is added - you can control that with the ' +
			'"Camera smoothness" setting. <br>' +
			'- "Instant" camera movement exactly follows your cells without lagging behind, gradually focusing more ' +
			'or less on cells while they split or die. There is no artificial smoothness, but you should use a ' +
			'higher draw delay (at least 100). You might find this significantly smoother than the default camera.');
		setting('Camera smoothness', [slider('cameraSmoothness', 2, 1, 10, 0.1, 1)],
			() => settings.cameraMovement === 'default',
			'How slowly the camera lags behind. The default is 2; using 4 moves the camera about twice as slowly, ' +
			'for example. Setting to 1 removes all camera smoothness.');
		setting('Zoom speed', [slider('scrollFactor', 1, 0.05, 1, 0.05, 2)], () => true,
			'A smaller zoom speed lets you fine-tune your zoom.');
		setting('Auto-zoom', [checkbox('autoZoom')], () => true,
			'When enabled, automatically zooms in/out for you based on how big you are.');
		setting('Move camera while spawning', [checkbox('cameraSpawnAnimation')], () => true,
			'When spawning, normally the camera will take a bit of time to move to where your cell spawned. This ' +
			'can be disabled.');

		separator('• multibox •');
		setting('Multibox keybind', [keybind('multibox')], () => true,
			'The key to press for switching multibox tabs. "Tab" is recommended, but you can also use "Ctrl+Tab" and ' +
			'most other keybinds.');
		setting(`Vision merging ${newTag}`,
			[dropdown('synchronization', [['flawless', 'Flawless (recommended)'], ['latest', 'Latest'], ['', 'None']])],
			() => !!settings.multibox || settings.nbox || settings.spectator,
			'How multiple connections synchronize the cells they can see. <br>' +
			'- "Flawless" ensures all connections are synchronized to be on the same ping. If one connection gets a ' +
			'lag spike, all connections will get that lag spike too. <br>' +
			'- "Latest" uses the most recent data across all connections. Lag spikes will be much less noticeable, ' +
			'however cells that are farther away might warp around and appear buggy. <br>' +
			'- "None" only shows what your current tab can see. <br>' +
			'"Flawless" is recommended for all users, however if you find it laggy you should try "Latest".');
		setting('One-tab mode', [checkbox('mergeCamera')], () => !!settings.multibox || settings.nbox,
			'When enabled, your camera will focus on both multibox tabs at once. Disable this if you prefer two-tab-' +
			'style multiboxing. <br>' +
			'When one-tab multiboxing, you <b>must</b> use the Natural (weighted) camera style.');
		setting('Multibox outline thickness', [slider('outlineMulti', 0.2, 0, 1, 0.01, 2)],
			() => !!settings.multibox || settings.nbox,
			'When multiboxing, rings appear on your cells, the thickness being a % of your cell radius. This only ' +
			'shows when you\'re near one of your tabs.');
		setting('Current tab outline color', [color('outlineMultiColor')], () => !!settings.multibox || settings.nbox,
			'The color of the rings around your current multibox tab. Only shown when near another tab. The slider ' +
			'is the outline opacity.');
		setting('Other tab outline color', [color('outlineMultiInactiveColor')], () => !!settings.multibox || settings.nbox,
			'The color of the rings around your other inactive multibox tabs. Only shown when near another tab. The ' +
			'slider is the outline opacity.');
		setting('Block respawns near other tabs', [checkbox('blockNearbyRespawns')], () => !!settings.multibox || settings.nbox,
			'When enabled, the respawn key (using SigMod) will be disabled if your multibox tabs are close. ' +
			'This means you can spam the respawn key until your multibox tab spawns nearby.');

		// don't allow turning on without multiboxing enabled first
		setting('N-boxing', [checkbox('nbox')], () => !!settings.multibox || settings.nbox,
			'<h1>ADVANCED USERS ONLY.</h1>' +
			'Enables multiboxing with 3 or more tabs (known as triboxing or quadboxing). <br>' +
			'Official Sigmally servers limit how many connections can be made from an IP address (usually 3). If you ' +
			'can\'t connect some of your tabs: <br>' +
			'- Try disabling the spectator tab for a third connection. <br>' +
			'- Try using proxies to connect via multiple IP addresses. <br>' +
			'- Try playing on a private server instead. <br>' +
			'When enabled, the multibox keybind above will cycle between all tabs.');
		setting('N-box tab count', [slider('nboxCount', 3, 3, 8, 1, 0)], () => settings.nbox,
			'The number of tabs to make available for selection.');
		setting('N-box change pair', [keybind('nboxCyclePair')],
			() => settings.nbox,
			'Pressing this key will cycle between selecting pairs #1/#2, #3/#4, #5/#6, and #7/#8. The last used tab ' +
			'in this pair will be selected. (Think of this as switching between multiple multibox game windows.)');
		setting('N-box switch within pair', [keybind('nboxSwitchPair')],
			() => settings.nbox,
			'Pressing this key will switch between tabs within your current pair (from #1/#2, #3/#4, #5/#6, or #7/#8).');
		for (let i = 0; i < 8; ++i) {
			setting(`N-box select tab #${i + 1}`, [keybind(i, settings.nboxSelectKeybinds)],
				() => settings.nbox && settings.nboxCount >= i + 1,
				`Pressing this key will switch to tab #${i + 1}.`);
		}
		for (let i = 0; i < 8; ++i) {
			setting(`N-box hold tab #${i + 1}`, [keybind(i, settings.nboxHoldKeybinds)],
				() => settings.nbox && settings.nboxCount >= i + 1,
				`Holding this key will temporarily switch to tab #${i + 1}. Releasing all n-box keys will return you ` +
				'to the last selected tab.');
		}
		for (let i = 2; i < 8; ++i) {
			setting(`N-box skin #${i + 1}`, [image(i, settings.selfSkinNbox, `selfSkinNbox.${i}`)],
				() => settings.nbox && settings.nboxCount >= i + 1,
				`A custom skin for tab #${i + 1}. You can drag+drop a skin here, or use a direct URL. Not ` +
				'visible to others.');
		}

		separator('• text •');
		setting('Name scale factor', [slider('nameScaleFactor', 1, 0.5, 2, 0.01, 2)], () => true,
			'The size multiplier of names.');
		setting('Mass scale factor', [slider('massScaleFactor', 1, 0.5, 4, 0.01, 2)], () => true,
			'The size multiplier of mass (which is half the size of names).');
		setting('Mass opacity', [slider('massOpacity', 1, 0, 1, 0.01, 2)], () => true,
			'The opacity of the mass text. You might find it visually appealing to have mass be a little dimmer than ' +
			'names.');
		setting('Bold name / mass text', [checkbox('nameBold'), checkbox('massBold')], () => true,
			'Uses the bold Ubuntu font (like Agar.io) for names (left checkbox) or mass (right checkbox).');
		setting('Show clans', [checkbox('clans')], () => true,
			'When enabled, shows the name of the clan a player is in above their name. ' +
			'If you turn off names (using SigMod), then player names will be replaced with their clan\'s.');
		setting('Clan scale factor', [slider('clanScaleFactor', 1, 0.5, 4, 0.01, 2)], () => settings.clans,
			'The size multiplier of a player\'s clan displayed above their name. When names are off, names will be ' +
			'replaced with clans and use the name scale factor instead.');
		setting('Text outline thickness', [slider('textOutlinesFactor', 1, 0, 2, 0.01, 2)], () => true,
			'The multiplier of the thickness of the black stroke around names, mass, and clans on cells. You can set ' +
			'this to 0 to disable outlines AND text shadows.');

		separator('• other •');
		setting('Theme color', [color('theme', true)], () => true,
			'If enabled, uses this color for the minimap (and chat, if not using SigMod). It\'s a small detail that ' +
			'can make the game feel more immersive.');
		setting('Block all browser keybinds', [checkbox('blockBrowserKeybinds')], () => true,
			'When enabled, only F11 is allowed to be pressed when in fullscreen. Most other browser and system ' +
			'keybinds will be disabled.');
		setting('Unsplittable cell outline', [color('unsplittableColor')], () => true,
			'The color of the ring around cells that cannot split. The slider ');
		setting('Jelly physics skin size lag', [checkbox('jellySkinLag')], () => true,
			'Jelly physics causes cells to grow and shrink slower than text and skins, making the game more ' +
			'satisfying. If you have a skin that looks weird only with jelly physics, try turning this off.');
		setting('Slower jelly physics', [checkbox('slowerJellyPhysics')], () => true,
			'Sigmally Fixes normally speeds up the jelly physics animation for it to be tolerable when splitrunning. ' +
			'If you prefer how it was in the vanilla client (really slow but satisfying), enable this setting.');
		setting('Cell / pellet glow', [checkbox('cellGlow'), checkbox('pelletGlow')], () => true,
			'When enabled, gives cells or pellets a slight glow. Basically, shaders for Sigmally. This is very ' +
			'optimized and should not impact performance.');
		setting('Rainbow border', [checkbox('rainbowBorder')], () => true,
			'Gives the map a rainbow border. So shiny!!!');
		setting('Top UI uses bold text', [checkbox('boldUi')], () => true,
			'When enabled, the top-left score and stats UI and the leaderboard will use the bold Ubuntu font.');
		setting('Show server stats', [checkbox('showStats')], () => true,
			'When disabled, hides the top-left server stats including the player count and server uptime.');
		setting('Connect spectating tab', [checkbox('spectator')], () => true,
			'Automatically connects an extra tab and sets it to spectate #1.');
		setting('Show spectator tab ping', [checkbox('spectatorLatency')], () => settings.spectator,
			'When enabled, shows another ping measurement for your spectator tab.');
		setting('Separate XP boost from score', [checkbox('separateBoost')], () => true,
			'If you have an XP boost, your score will be doubled. If you don\'t want that, you can separate the XP ' +
			'boost from your score.');
		setting('Color under skin', [checkbox('colorUnderSkin')], () => true,
			'When disabled, transparent skins will be see-through and not show your cell color. Turn this off ' +
			'if using a bubble skin, for example.');
		setting('Move after linesplit', [checkbox('moveAfterLinesplit')], () => true,
			'When doing a horizontal or vertical linesplit, your position is frozen. With this setting enabled, you ' +
			'will begin moving forwards in that axis once you split, letting you go farther than normal.');
		setting(`Delay pushsplits ${newTag}`, [checkbox('delayDouble')], () => true,
			'When in 5+ cells, doing a doublesplit may cause your cells to go like { O∘∘ } and not { ∘∘∘∘ } - which ' +
			'is useful, but when using the doublesplit keybind, those small back pieces may go in front. ' +
			'When this setting is enabled, a 50ms delay will be added to the second split only when in 5+ cells, ' +
			'typically fixing the problem.');

		// #3 : create options for sigmod
		let sigmodInjection;
		sigmodInjection = setInterval(() => {
			const nav = document.querySelector('.mod_menu_navbar');
			const content = document.querySelector('.mod_menu_content');
			if (!nav || !content) return;

			clearInterval(sigmodInjection);
			content.appendChild(sigmodContainer);

			const navButton = fromHTML('<button class="mod_nav_btn">🔥 Sig Fixes</button>');
			nav.appendChild(navButton);
			navButton.addEventListener('click', () => {
				// basically openModTab() from sigmod
				(/** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll('.mod_tab'))).forEach(tab => {
					tab.style.opacity = '0';
					setTimeout(() => tab.style.display = 'none', 200);
				});

				(/** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll('.mod_nav_btn'))).forEach(tab => {
					tab.classList.remove('mod_selected');
				});

				navButton.classList.add('mod_selected');
				setTimeout(() => {
					sigmodContainer.style.display = 'flex';
					setTimeout(() => sigmodContainer.style.opacity = '1', 10);
				}, 200);
			});
		}, 100);

		return settings;
	})();



	/////////////////////
	// Prepare Game UI //
	/////////////////////
	const ui = (() => {
		const ui = {};

		(() => {
			const title = document.querySelector('#title');
			if (!title) return;

			const watermark = document.createElement('span');
			watermark.innerHTML = `<a href="https://greasyfork.org/scripts/483587/versions" \
				target="_blank">Sigmally Fixes ${sfVersion}</a> by yx`;
			if (sfVersion.includes('BETA')) {
				watermark.innerHTML += ' <br><a \
					href="https://raw.githubusercontent.com/8y8x/sigmally-fixes/refs/heads/main/sigmally-fixes.user.js"\
					target="_blank">[Update beta here]</a>';
			}
			title.insertAdjacentElement('afterend', watermark);

			// check if this version is problematic, don't do anything if this version is too new to be in versions.json
			// take care to ensure users can't be logged
			fetch('https://raw.githubusercontent.com/8y8x/sigmally-fixes/main/versions.json').then(res => res.json())
				.then(res => {
					if (!sfVersion in res || res[sfVersion].ok || !res[sfVersion].alert) return;
					const color = res[sfVersion].color || '#f00';
					const box = document.createElement('div');
					box.style.cssText = `background: ${color}3; border: 1px solid ${color}; width: 100%;
						height: fit-content; font-size: 1em; padding: 5px; margin: 5px 0; border-radius: 3px;
						color: ${color}`;
					box.innerHTML = String(res[sfVersion].alert)
						.replace(/\<|\>/g, '') // never allow html tag injection
						.replace(/\{link\}/g, '<a href="https://greasyfork.org/scripts/483587">[click here]</a>')
						.replace(/\{autolink\}/g, '<a href="\
							https://update.greasyfork.org/scripts/483587/Sigmally%20Fixes%20V2.user.js">\
							[click here]</a>');

					watermark.insertAdjacentElement('afterend', box);
				});
		})();

		ui.game = (() => {
			const game = {};

			/** @type {HTMLCanvasElement | null} */
			const oldCanvas = document.querySelector('canvas#canvas');
			if (!oldCanvas) throw 'exiting script - no canvas found';
			// leave the old canvas so the old client can actually run
			oldCanvas.style.display = 'none';

			const newCanvas = document.createElement('canvas');
			newCanvas.id = 'sf-canvas';
			newCanvas.style.cssText = `background: #003; width: 100vw; height: 100vh; position: fixed; top: 0; left: 0;
				z-index: 1;`;
			game.canvas = newCanvas;
			(document.querySelector('body div') ?? document.body).appendChild(newCanvas);

			// TODO: are these necessary anymore?
			// forward macro inputs from the canvas to the old one - this is for sigmod mouse button controls
			newCanvas.addEventListener('mousedown', e => oldCanvas.dispatchEvent(new MouseEvent('mousedown', e)));
			newCanvas.addEventListener('mouseup', e => oldCanvas.dispatchEvent(new MouseEvent('mouseup', e)));
			// forward mouse movements from the old canvas to the window - this is for sigmod keybinds that move
			// the mouse
			oldCanvas.addEventListener('mousemove', e => dispatchEvent(new MouseEvent('mousemove', e)));

			const gl = aux.require(
				newCanvas.getContext('webgl2', { alpha: false, antialias: false, depth: false }),
				'Couldn\'t get WebGL2 context. Possible causes:\r\n' +
				'- Maybe GPU/Hardware acceleration needs to be enabled in your browser settings; \r\n' +
				'- Maybe your browser is just acting weird and it might fix itself after a restart; \r\n' +
				'- Maybe your GPU drivers are exceptionally old.',
			);
			game.gl = gl;

			// indicate that we will restore the context
			newCanvas.addEventListener('webglcontextlost', e => e.preventDefault()); 
			newCanvas.addEventListener('webglcontextrestored', () => {
				glconf.init();
				// cleanup old caches (after render), as we can't do this within glconf.init()
				render.resetDatabaseCache();
				render.resetTextCache();
				render.resetTextureCache();
			});

			const resize = () => {
				// devicePixelRatio does not have very high precision; it could be 0.800000011920929 for example
				newCanvas.width = Math.ceil(innerWidth * (devicePixelRatio - 0.0001));
				newCanvas.height = Math.ceil(innerHeight * (devicePixelRatio - 0.0001));
				game.gl.viewport(0, 0, newCanvas.width, newCanvas.height);
			}
			addEventListener('resize', resize);
			resize();

			return game;
		})();

		ui.stats = (() => {
			const container = document.createElement('div');
			container.style.cssText = 'position: fixed; top: 10px; left: 10px; width: 400px; height: fit-content; \
				user-select: none; z-index: 2; transform-origin: top left; font-family: Ubuntu;';
			document.body.appendChild(container);

			const score = document.createElement('div');
			score.style.cssText = 'font-size: 30px; color: #fff; line-height: 1.0;';
			container.appendChild(score);

			const measures = document.createElement('div');
			measures.style.cssText = 'font-size: 20px; color: #fff; line-height: 1.1;';
			container.appendChild(measures);

			const misc = document.createElement('div');
			// white-space: pre; allows using \r\n to insert line breaks
			misc.style.cssText = 'font-size: 14px; color: #fff; white-space: pre; line-height: 1.1; opacity: 0.5;';
			container.appendChild(misc);

			/** @param {symbol} view */
			const update = view => {
				const fontFamily = `"${sigmod.settings.font || 'Ubuntu'}", Ubuntu`;
				if (container.style.fontFamily !== fontFamily) container.style.fontFamily = fontFamily;

				const color = aux.settings.darkTheme ? '#fff' : '#000';
				score.style.color = color;
				measures.style.color = color;
				misc.style.color = color;

				score.style.fontWeight = measures.style.fontWeight = settings.boldUi ? 'bold' : 'normal';
				measures.style.opacity = settings.showStats ? '1' : '0.5';
				misc.style.opacity = settings.showStats ? '0.5' : '0';

				const scoreVal = world.score(world.selected);
				if (scoreVal > world.stats.highestScore) world.stats.highestScore = scoreVal;
				if (scoreVal <= 0) score.innerHTML = '';
				else if (typeof aux.userData?.boost === 'number' && Date.now() < aux.userData.boost) {
					if (settings.separateBoost)
						score.innerHTML = `Score: ${Math.floor(scoreVal)} <span style="color: #fc6;">(X2)</span>`;
					else
						score.innerHTML = `Score: ${Math.floor(scoreVal * 2)}`;
				} else score.innerHTML = `Score: ${Math.floor(scoreVal)}`;

				const con = net.connections.get(view);
				let measuresText = `${Math.floor(render.fps)} FPS`;
				if (con?.latency !== undefined) {
					measuresText += ` ${con.latency === -1 ? '????' : Math.floor(con.latency)}ms`;
					const spectateCon = net.connections.get(world.viewId.spectate);
					if (settings.spectatorLatency && spectateCon?.latency !== undefined) {
						measuresText
							+= ` (${spectateCon.latency === -1 ? '????' : Math.floor(spectateCon.latency)}ms)`;
					}
					measuresText += ' ping';
				}
				measures.textContent = measuresText;
			};

			/** @param {object | undefined} stats */
			const updateStats = (stats) => {
				if (!stats) {
					misc.textContent = '';
					return;
				}

				let uptime;
				if (stats.uptime < 60) {
					uptime = Math.floor(stats.uptime) + 's';
				} else {
					uptime = Math.floor(stats.uptime / 60 % 60) + 'min';
					if (stats.uptime >= 60 * 60)
						uptime = Math.floor(stats.uptime / 60 / 60 % 24) + 'hr ' + uptime;
					if (stats.uptime >= 24 * 60 * 60)
						uptime = Math.floor(stats.uptime / 24 / 60 / 60 % 60) + 'd ' + uptime;
				}

				misc.textContent = [
					`${stats.name} (${stats.gamemode})`,
					`${stats.external} / ${stats.limit} players`,
					// bots do not count towards .playing
					`${stats.playing} playing` + (stats.internal > 0 ? ` + ${stats.internal} bots` : ''),
					`${stats.spectating} spectating`,
					`${(stats.loadTime / 40 * 100).toFixed(1)}% load @ ${uptime}`,
				].join('\r\n');
			};

			/** @type {object | undefined} */
			let lastStats;
			setInterval(() => { // update as frequently as possible
				const currentStats = world.views.get(world.selected)?.stats;
				if (currentStats !== lastStats) updateStats(lastStats = currentStats);
			});

			return { update };
		})();

		ui.leaderboard = (() => {
			const container = document.createElement('div');
			container.style.cssText = 'position: fixed; top: 10px; right: 10px; width: 200px; height: fit-content; \
				user-select: none; z-index: 2; background: #0006; padding: 15px 5px; transform-origin: top right; \
				display: none;';
			document.body.appendChild(container);

			const title = document.createElement('div');
			title.style.cssText = 'font-family: Ubuntu; font-size: 30px; color: #fff; text-align: center; width: 100%;';
			title.textContent = 'Leaderboard';
			container.appendChild(title);

			const linesContainer = document.createElement('div');
			linesContainer.style.cssText = `font-family: Ubuntu; font-size: 20px; line-height: 1.2; width: 100%;
				height: fit-content; text-align: center; white-space: pre; overflow: hidden;`;
			container.appendChild(linesContainer);

			/** @type {HTMLDivElement[]} */
			const lines = [];
			/** @param {{ me: boolean, name: string, sub: boolean, place: number | undefined }[]} lb */
			const update = lb => {
				const fontFamily = `"${sigmod.settings.font || 'Ubuntu'}", Ubuntu`;
				if (linesContainer.style.fontFamily !== fontFamily)
					linesContainer.style.fontFamily = title.style.fontFamily = fontFamily;

				const friends = /** @type {any} */ (window).sigmod?.friend_names;
				const friendSettings = /** @type {any} */ (window).sigmod?.friends_settings;
				lb.forEach((entry, i) => {
					let line = lines[i];
					if (!line) {
						line = document.createElement('div');
						line.style.display = 'none';
						linesContainer.appendChild(line);
						lines.push(line);
					}

					line.style.display = 'block';
					line.textContent = `${entry.place ?? i + 1}. ${entry.name || 'An unnamed cell'}`;
					if (entry.me) line.style.color = '#faa';
					else if (friends instanceof Set && friends.has(entry.name) && friendSettings?.highlight_friends)
						line.style.color = friendSettings.highlight_color;
					else if (entry.sub) line.style.color = '#ffc826';
					else line.style.color = '#fff';
				});

				for (let i = lb.length; i < lines.length; ++i)
					lines[i].style.display = 'none';

				container.style.display = lb.length > 0 ? '' : 'none';
				container.style.fontWeight = settings.boldUi ? 'bold' : 'normal';
			}

			/** @type {object | undefined} */
			let lastLb;
			setInterval(() => { // update leaderboard frequently
				const currentLb = world.views.get(world.selected)?.leaderboard;
				if (currentLb !== lastLb) update((lastLb = currentLb) ?? []);
			});
		})();

		const mainMenu = aux.require(document.querySelector('#__line1')?.parentElement,
			'Can\'t find the main menu UI. Try reloading the page?');
		const statsContainer = aux.require(document.querySelector('#__line2'),
			'Can\'t find the death screen UI. Try reloading the page?');
		const continueButton = aux.require(document.querySelector('#continue_button'),
			'Can\'t find the continue button (on death). Try reloading the page?');

		const menuLinks = document.querySelector('#menu-links');
		const overlay = document.querySelector('#overlays');
		// sigmod uses this to detect if the menu is closed or not, otherwise this is unnecessary
		const menuWrapper = document.querySelector('#menu-wrapper');

		let escOverlayVisible = true;
		ui.escOverlayVisible = () => escOverlayVisible;
		/**
		 * @param {boolean} [show]
		 */
		ui.toggleEscOverlay = show => {
			escOverlayVisible = show ?? !escOverlayVisible;
			mainMenu.style.display = escOverlayVisible ? '' : 'none';
			if (overlay) overlay.style.display = escOverlayVisible ? '' : 'none';
			if (menuLinks) menuLinks.style.display = escOverlayVisible ? '' : 'none';
			if (menuWrapper) menuWrapper.style.display = escOverlayVisible ? '' : 'none';

			if (escOverlayVisible) ui.deathScreen.hide();
			ui.captcha.reposition();
		};

		ui.deathScreen = (() => {
			const deathScreen = {};
			let visible = false;

			continueButton.addEventListener('click', () => {
				ui.toggleEscOverlay(true);
				visible = false;
			});

			deathScreen.check = () => {
				if (world.stats.spawnedAt !== undefined && !world.alive()) deathScreen.show();
			};

			const bonus = document.querySelector('#menu__bonus');
			deathScreen.show = () => {
				const boost = typeof aux.userData?.boost === 'number' && aux.userData.boost > Date.now();
				if (bonus) {
					if (boost) {
						bonus.style.display = '';
						bonus.textContent = `Bonus score: ${Math.floor(world.stats.highestScore)}`;
					} else {
						bonus.style.display = 'none';
					}
				}

				const foodEatenElement = document.querySelector('#food_eaten');
				if (foodEatenElement) foodEatenElement.textContent = String(world.stats.foodEaten);

				const highestMassElement = document.querySelector('#highest_mass');
				if (highestMassElement)
					highestMassElement.textContent = String(Math.floor(world.stats.highestScore) * (boost ? 2 : 1));

				const highestPositionElement = document.querySelector('#top_leaderboard_position');
				if (highestPositionElement) highestPositionElement.textContent = String(world.stats.highestPosition);

				const timeAliveElement = document.querySelector('#time_alive');
				if (timeAliveElement) {
					const time = (performance.now() - (world.stats.spawnedAt ?? 0)) / 1000;
					const hours = Math.floor(time / 60 / 60);
					const mins = Math.floor(time / 60 % 60);
					const seconds = Math.floor(time % 60);

					timeAliveElement.textContent = `${hours ? hours + 'h' : ''} ${mins ? mins + 'm' : ''} `
						+ `${seconds ? seconds + 's' : ''}`;
				}

				statsContainer.classList.remove('line--hidden');
				visible = true;
				ui.toggleEscOverlay(false);
				if (overlay) overlay.style.display = '';
				world.stats = { foodEaten: 0, highestPosition: 200, highestScore: 0, spawnedAt: undefined };
				ui.captcha.reposition();
			};

			deathScreen.hide = () => {
				statsContainer?.classList.add('line--hidden');
				visible = false;
				// no need for ui.captcha.reposition() because the esc overlay will always be shown on deathScreen.hide
				// ads are managed by the game client
			};

			deathScreen.visible = () => visible;

			return deathScreen;
		})();

		ui.minimap = (() => {
			const canvas = document.createElement('canvas');
			canvas.style.cssText = 'position: fixed; bottom: 0; right: 0; background: #0006; width: 200px; \
				height: 200px; z-index: 2; user-select: none;';
			canvas.width = canvas.height = 200;
			document.body.appendChild(canvas);

			const ctx = aux.require(
				canvas.getContext('2d', { willReadFrequently: false }),
				'Unable to get 2D context for the minimap. This is probably your browser being dumb, maybe refresh?',
			);

			return { canvas, ctx };
		})();

		ui.chat = (() => {
			const chat = {};

			const block = aux.require(document.querySelector('#chat_block'), 'Can\'t find the chat UI, maybe refresh?');

			/**
			 * @param {ParentNode} root
			 * @param {string} selector
			 */
			function clone(root, selector) {
				/** @type {HTMLElement} */
				const old = aux.require(root.querySelector(selector), `Can't find this chat element: ${selector}.`);

				const el = /** @type {HTMLElement} */ (old.cloneNode(true));
				el.id = '';
				old.style.display = 'none';
				old.insertAdjacentElement('afterend', el);
				return el;
			}

			// can't just replace the chat box - otherwise sigmod can't hide it - so we make its children invisible
			// elements grabbed with clone() are only styled by their class, not id
			const toggle = clone(document, '#chat_vsbltyBtn');
			const scrollbar = clone(document, '#chat_scrollbar');
			const thumb = clone(scrollbar, '#chat_thumb');

			const input = chat.input = /** @type {HTMLInputElement} */ (aux.require(
				document.querySelector('#chat_textbox'),
				'Can\'t find the chat textbox. Try reloading the page?',
			));

			// allow zooming in/out on trackpad without moving the UI
			input.style.position = toggle.style.position = scrollbar.style.position = 'fixed';

			const list = document.createElement('div');
			list.style.cssText = 'width: 400px; height: 182px; position: fixed; bottom: 54px; left: 46px; \
				overflow: hidden; user-select: none; z-index: 301;';
			block.appendChild(list);

			let toggled = true;
			toggle.style.borderBottomLeftRadius = '10px'; // a bug fix :p
			toggle.addEventListener('click', () => {
				toggled = !toggled;
				input.style.display = toggled ? '' : 'none';
				scrollbar.style.display = toggled ? 'block' : 'none';
				list.style.display = toggled ? '' : 'none';
				toggle.style.borderTopRightRadius = toggle.style.borderBottomRightRadius = toggled ? '' : '10px';
				toggle.style.opacity = toggled ? '' : '0.25';
			});

			scrollbar.style.display = 'block';
			let scrollTop = 0; // keep a float here, because list.scrollTop is always casted to an int
			let thumbHeight = 1;
			let lastY;
			thumb.style.height = '182px';

			const updateThumb = () => {
				thumb.style.bottom = (1 - list.scrollTop / (list.scrollHeight - 182)) * (182 - thumbHeight) + 'px';
			};

			const scroll = () => {
				if (scrollTop >= list.scrollHeight - 182 - 40) { // close to bottom, snap downwards
					list.scrollTop = scrollTop = list.scrollHeight - 182;
				}

				thumbHeight = Math.min(Math.max(182 / list.scrollHeight, 0.1), 1) * 182;
				thumb.style.height = thumbHeight + 'px';
				updateThumb();
			}

			let scrolling = false;
			thumb.addEventListener('mousedown', () => void (scrolling = true));
			addEventListener('mouseup', () => void (scrolling = false));
			addEventListener('mousemove', e => {
				const deltaY = e.clientY - lastY;
				lastY = e.clientY;

				if (!scrolling) return;
				e.preventDefault(); // TODO why?

				list.scrollTop = scrollTop =
					Math.min(Math.max(scrollTop + deltaY * list.scrollHeight / 182, 0), list.scrollHeight - 182);
				updateThumb();
			});

			let lastWasBarrier = true; // init to true, so we don't print a barrier as the first ever message (ugly)
			/**
			 * @param {string} authorName
			 * @param {[number, number, number, number]} rgb
			 * @param {string} text
			 * @param {boolean} server
			 */
			chat.add = (authorName, rgb, text, server) => {
				lastWasBarrier = false;

				const container = document.createElement('div');
				const author = document.createElement('span');
				author.style.cssText = `color: ${aux.rgba2hex(...rgb)}; padding-right: 0.75em;`;
				author.textContent = aux.trim(authorName);
				container.appendChild(author);

				const msg = document.createElement('span');
				if (server) msg.style.cssText = `color: ${aux.rgba2hex(...rgb)}`;
				msg.textContent = server ? text : aux.trim(text); // /help text can get cut off
				container.appendChild(msg);

				while (list.children.length > 100) list.firstChild?.remove();
				list.appendChild(container);
				scroll();
			};

			chat.barrier = () => {
				if (lastWasBarrier) return;
				lastWasBarrier = true;

				const barrier = document.createElement('div');
				barrier.style.cssText = 'width: calc(100% - 20px); height: 1px; background: #8888; margin: 10px;';
				list.appendChild(barrier);
				scroll();
			};

			chat.matchTheme = () => {
				list.style.color = aux.settings.darkTheme ? '#fffc' : '#000c';
				// make author names darker in light theme
				list.style.filter = aux.settings.darkTheme ? '' : 'brightness(75%)';

				toggle.style.backgroundColor = settings.theme[3] ? aux.rgba2hex6(...settings.theme) : '#e37955';
				thumb.style.backgroundColor = settings.theme[3] ? aux.rgba2hex6(...settings.theme) : '#fc7200';
			};
			chat.matchTheme();
			setInterval(() => chat.matchTheme(), 500);

			return chat;
		})();

		/** @param {string} msg */
		ui.error = msg => {
			const modal = /** @type {HTMLElement | null} */ (document.querySelector('#errormodal'));
			if (modal) modal.style.display = 'block';
			const desc = document.querySelector('#errormodal p');
			if (desc) desc.innerHTML = msg;
		};

		ui.captcha = (() => {
			const captcha = {};

			const modeBtns = /** @type {HTMLElement | null} */ (document.querySelector('.mode-btns'));
			/** @type {HTMLButtonElement} */
			const play = aux.require(document.querySelector('button#play-btn'),
				'Can\'t find the play button. Try reloading the page?');
			/** @type {HTMLButtonElement} */
			const spectate = aux.require(document.querySelector('button#spectate-btn'),
				'Can\'t find the spectate button. Try reloading the page?');

			let grecaptchaResolve;
			const grecaptcha = new Promise(r => grecaptchaResolve = r);
			let turnstileResolve;
			const turnstile = new Promise(r => turnstileResolve = r);
			let CAPTCHA2, CAPTCHA3, TURNSTILE;

			const empty = { execute: () => {}, ready: () => {}, render: () => {}, reset: () => {} };
			let readyCheck;
			readyCheck = setInterval(() => {
				// it's possible that recaptcha or turnstile may be removed in the future, so stay safe
				if (grecaptchaResolve) {
					let grecaptchaReal;
					({ grecaptcha: grecaptchaReal, CAPTCHA2, CAPTCHA3 } = /** @type {any} */ (window));
					if (grecaptchaReal?.ready && CAPTCHA2 && CAPTCHA3) {
						const resolve = grecaptchaResolve;
						grecaptchaResolve = undefined;

						grecaptchaReal.ready(() => {
							// prevent game.js from using grecaptcha and messing things up
							let { grecaptcha: grecaptchaNew } = /** @type {any} */ (window);
							/** @type {any} */ (window).grecaptcha = empty;
							resolve(grecaptchaNew);
						});
					}
				}

				if (turnstileResolve) {
					let turnstileReal;
					({ turnstile: turnstileReal, TURNSTILE } = /** @type {any} */ (window));
					if (turnstileReal?.ready && TURNSTILE) {
						const resolve = turnstileResolve;
						turnstileResolve = undefined;

						// turnstile.ready not needed; prevent game.js from using turnstile and messing things up
						/** @type {any} */ (window).turnstile = empty;
						resolve(turnstileReal);
					}
				}

				if (!grecaptchaResolve && !turnstileResolve) clearInterval(readyCheck);
			}, 50);

			/**
			 * @typedef {{
			 * 	cb: ((token: string) => void) | undefined,
			 * 	handle: any,
			 * 	mount: HTMLElement,
			 * 	reposition: () => boolean,
			 * 	type: string,
			 * }} CaptchaInstance
			 * @type {Map<symbol, CaptchaInstance>}
			 */
			const captchas = new Map();

			/** @param {symbol} view */
			captcha.remove = view => {
				const inst = captchas.get(view);
				if (!inst) return;

				if (inst.type === 'v2') grecaptcha.then(g => g.reset(inst.handle));
				// don't do anything for v3
				else if (inst.type === 'turnstile') turnstile.then(t => t.remove(inst.handle));

				inst.cb = () => {}; // ensure the token gets voided if solved
				inst.mount.remove();
				captchas.delete(view);
				captcha.reposition(); // ensure play/spectate buttons reappear
			};

			/**
			 * @param {symbol} view
			 * @param {string} type
			 * @param {(token: string) => void} cb
			 */
			captcha.request = (view, type, cb) => {
				const oldInst = captchas.get(view);
				if (oldInst?.type === type && oldInst.cb) {
					oldInst.cb = cb;
					return;
				}

				captcha.remove(view);

				const mount = document.createElement('div');
				document.body.appendChild(mount);
				const reposition = () => {
					if (view === world.viewId.spectate) {
						mount.style.cssText = 'position: fixed; bottom: 10px; left: 50vw; transform: translateX(-50%); \
							z-index: 1000;';
					} else if (view !== world.selected || ui.deathScreen.visible()) {
						mount.style.cssText = 'opacity: 0;'; // don't use display: none;
					} else if (escOverlayVisible && modeBtns) {
						const place = modeBtns?.getBoundingClientRect();
						mount.style.cssText = `position: fixed; top: ${place ? place.top + 'px' : '50vh'};
							left: ${place ? (place.left + place.width / 2) + 'px' : '50vw'};
							transform: translate(-50%, ${place ? '0%' : '-50%'}); z-index: 1000;`;
					} else {
						mount.style.cssText = `position: fixed; top: 50vh; left: 50vw; transform: translate(-50%, -50%);
							z-index: 1000;`;
					}

					return type !== 'v3'; // v3 is invisible, so it shouldn't hide the play buttons
				};

				/** @type {CaptchaInstance} */
				const inst = { cb, handle: undefined, mount, reposition, type };
				captchas.set(view, inst);
				captcha.reposition();

				if (type === 'v2' || type === 'turnstile') {
					(type === 'v2' ? grecaptcha : turnstile).then(m => {
						inst.handle = m.render(mount, {
							callback: token => {
								inst.cb?.(token);
								inst.cb = undefined;
							},
							'error-callback': () => setTimeout(() => m.reset(inst.handle), 1000),
							'expired-callback': () => setTimeout(() => m.reset(inst.handle), 1000),
							sitekey: type === 'v2' ? CAPTCHA2 : TURNSTILE,
							theme: sigmod.exists ? 'dark' : 'light',
						});
					});
				} else if (type === 'v3') {
					grecaptcha.then(g => {
						g.execute(CAPTCHA3).then(token => {
							inst.cb?.(token);
							inst.cb = undefined;
						});
					});
				}
			};

			captcha.reposition = () => {
				let replacingModeButtons = false;
				for (const inst of captchas.values()) replacingModeButtons = inst.reposition() || replacingModeButtons;

				play.style.display = spectate.style.display = replacingModeButtons ? 'none' : '';
			};
			addEventListener('resize', () => captcha.reposition());

			return captcha;
		})();

		ui.linesplit = (() => {
			const linesplit = {};

			const overlay = document.createElement('div');
			overlay.style.cssText = `position: fixed; bottom: 10px; left: 50vw; transform: translateX(-50%);
				font: bold 24px Ubuntu; color: #fffc; z-index: 999;`;
			document.body.appendChild(overlay);

			linesplit.update = () => {
				const inputs = input.views.get(world.selected);
				if (!inputs?.lock) {
					overlay.style.display = 'none';
					return;
				}

				overlay.style.color = aux.settings.darkTheme ? '#fffc' : '#000c';
				if (inputs.lock.type === 'horizontal') {
					// left-right arrow svg
					overlay.innerHTML = `
						<svg viewBox="-6 0 36 24" style="width: 36px; height: 24px; vertical-align: bottom;">
    						<path stroke="currentColor" stroke-width="3" fill="none"
								d="M22,12 L2,12 M6,8 L2,12 L6,16 M18,8 L22,12 L18,16"></path>
    					</svg>(${sigmod.settings?.horizontalLineKey?.toUpperCase()})`;
					overlay.style.display = '';
				} else if (inputs.lock.type === 'vertical') {
					// up-down arrow svg
					overlay.innerHTML = `
						<svg viewBox="0 0 24 24" style="width: 24px; height: 24px; vertical-align: bottom;">
    						<path stroke="currentColor" stroke-width="3" fill="none"
								d="M12,22 L12,2 M8,6 L12,2 L16,6 M8,18 L12,22 L16,18"></path>
    					</svg>(${sigmod.settings?.verticalLineKey?.toUpperCase()})`;
					overlay.style.display = '';
				} else if (inputs.lock.type === 'fixed') {
					// left-right + up-down arrow svg
					overlay.innerHTML = `
						<svg viewBox="-6 0 36 24" style="width: 36px; height: 24px; vertical-align: bottom;">
    						<path stroke="currentColor" stroke-width="3" fill="none"
								d="M22,12 L2,12 M6,8 L2,12 L6,16 M18,8 L22,12 L18,16
								M12,22 L12,2 M8,6 L12,2 L16,6 M8,18 L12,22 L16,18"></path>
    					</svg>(${sigmod.settings?.fixedLineKey?.toUpperCase()})`;
					overlay.style.display = '';
				}
			};

			return linesplit;
		})();

		const style = document.createElement('style');
		style.innerHTML = `
			/* make sure nothing gets cut off on the center menu panel */
			#menu-wrapper > .menu-center { height: fit-content !important; }
			/* hide the outline that sigmod puts on the minimap (i don't like it) */
			.minimap { border: none !important; box-shadow: none !important; }`;
		document.head.appendChild(style);

		return ui;
	})();



	///////////////////////////
	// Setup World Variables //
	///////////////////////////
	/**
	 * @typedef {{
	 * 	nx: number, ny: number, nr: number,
	 * 	born: number, deadAt: number | undefined, deadTo: number,
	 * }} CellFrameWritable
	 * @typedef {Readonly<CellFrameWritable>} CellFrame
	 * @typedef {{
	 * 	ox: number, oy: number, or: number,
	 * 	jr: number, a: number, updated: number,
	 * }} CellInterpolation
	 * @typedef {{
	 *  name: string, skin: string, sub: boolean, clan: string,
	 * 	rgb: [number, number, number],
	 * 	jagged: boolean, eject: boolean,
	 * }} CellDescription
	 * @typedef {CellInterpolation & CellDescription & { frames: CellFrame[] }} CellRecord
	 * @typedef {{
	 * 	id: number,
	 * 	merged: (CellFrameWritable & CellInterpolation) | undefined,
	 * 	model: CellFrame | undefined,
	 * 	views: Map<symbol, CellRecord>,
	 * }} Cell
	 * @typedef {{
	 * 	border: { l: number, r: number, t: number, b: number } | undefined,
	 * 	camera: {
	 * 		x: number, tx: number,
	 * 		y: number, ty: number,
	 * 		scale: number, tscale: number,
	 * 		merged: boolean,
	 * 		updated: number,
	 * 	},
	 * 	leaderboard: { name: string, me: boolean, sub: boolean, place: number | undefined }[],
	 * 	owned: Set<number>,
	 * 	spawned: number,
	 * 	stats: object | undefined,
	 * 	used: number,
	 * }} Vision
	 */
	const world = (() => {
		const world = {};

		/** @type {Map<number, Cell>} */
		world.cells = new Map();
		/** @type {Map<number, Cell>} */
		world.pellets = new Map();
		world.multis = [Symbol(), Symbol(), Symbol(), Symbol(), Symbol(), Symbol(), Symbol(), Symbol()];
		world.viewId = { primary: world.multis[0], secondary: world.multis[1], spectate: Symbol() };
		world.selected = world.viewId.primary;
		/** @type {Map<symbol, Vision>} */
		world.views = new Map();

		world.alive = () => {
			for (const [view, vision] of world.views) {
				for (const id of vision.owned) {
					const cell = world.cells.get(id);
					// if a cell does not exist yet, we treat it as alive
					if (!cell) return true;
					if (cell.views.get(view)?.frames[0].deadAt === undefined) return true;
				}
			}
			return false;
		};

		/**
		 * @typedef {{ mass: number, scale: number, sumX: number, sumY: number, weight: number }} SingleCamera
		 * @param {symbol} view
		 * @param {Vision | undefined} vision
		 * @param {number} weightExponent
		 * @param {number} now
		 * @returns {SingleCamera}
		 */
		world.singleCamera = (view, vision, weightExponent, now) => {
			vision ??= world.views.get(view);
			if (!vision) return { mass: 0, scale: 1, sumX: 0, sumY: 0, weight: 0 };

			let mass = 0, r = 0, sumX = 0, sumY = 0, weight = 0;
			for (const id of (vision.owned ?? [])) {
				const cell = world.cells.get(id);
				/** @type {CellFrame | undefined} */
				const frame = world.synchronized ? cell?.merged : cell?.views.get(view)?.frames[0];
				/** @type {CellInterpolation | undefined} */
				const interp = world.synchronized ? cell?.merged : cell?.views.get(view);
				if (!frame || !interp) continue;
				// don't include cells owned before respawning
				if (frame.born < vision.spawned) continue;

				if (settings.cameraMovement === 'instant') {
					const xyr = world.xyr(frame, interp, undefined, undefined, false, now);
					r += xyr.r * xyr.a;
					mass += (xyr.r * xyr.r / 100) * xyr.a;
					const cellWeight = xyr.a * (xyr.r ** weightExponent);
					sumX += xyr.x * cellWeight;
					sumY += xyr.y * cellWeight;
					weight += cellWeight;
				} else { // settings.cameraMovement === 'default'
					if (frame.deadAt !== undefined) continue;
					const xyr = world.xyr(frame, interp, undefined, undefined, false, now);
					r += frame.nr;
					mass += frame.nr * frame.nr / 100;
					const cellWeight = frame.nr ** weightExponent;
					sumX += xyr.x * cellWeight;
					sumY += xyr.y * cellWeight;
					weight += cellWeight;
				}
			}

			return { mass, scale: Math.min(64 / r, 1) ** 0.4, sumX, sumY, weight };
		};

		/**
		 * @param {number} now
		 */
		world.cameras = now => {
			const weightExponent = settings.camera !== 'default' ? 2 : 0;

			// #1 : create disjoint sets of all cameras that are close together
			/** @type {Map<symbol, SingleCamera>}>} */
			const cameras = new Map();
			/** @type {Map<symbol, Set<symbol>>} */
			const sets = new Map();
			for (const [view, vision] of world.views) {
				cameras.set(view, world.singleCamera(view, vision, weightExponent, now));
				sets.set(view, new Set([view]));
			}

			// compute even if tabs won't actually be merged, because the multi outlines must still show
			if (settings.multibox || settings.nbox) {
				for (const [view, vision] of world.views) {
					const set = /** @type {Set<symbol>} */ (sets.get(view));

					const camera = /** @type {SingleCamera} */ (cameras.get(view));
					if (camera.weight <= 0 || now - vision.used > 20_000) continue; // don't merge with inactive tabs
					const x = camera.sumX / camera.weight;
					const y = camera.sumY / camera.weight;
					const width = 1920 / 2 / camera.scale;
					const height = 1080 / 2 / camera.scale;

					for (const [otherView, otherVision] of world.views) {
						const otherSet = /** @type {Set<symbol>} */ (sets.get(otherView));
						if (set === otherSet || now - otherVision.used > 20_000) continue;

						const otherCamera = /** @type {SingleCamera} */ (cameras.get(otherView));
						if (otherCamera.weight <= 0) continue;
						const otherX = otherCamera.sumX / otherCamera.weight;
						const otherY = otherCamera.sumY / otherCamera.weight;
						const otherWidth = 1920 / 2 / otherCamera.scale;
						const otherHeight = 1080 / 2 / otherCamera.scale;

						// only merge with tabs if their vision regions are close. expand threshold depending on
						// how much mass each tab has (if both tabs are large, allow them to go pretty far)
						const threshold = 1000 + Math.min(camera.weight / 100 / 25, otherCamera.weight / 100 / 25);
						if (Math.abs(x - otherX) <= width + otherWidth + threshold
								&& Math.abs(y - otherY) <= height + otherHeight + threshold) {
							// merge disjoint sets
							for (const connectedView of otherSet) {
								set.add(connectedView);
								sets.set(connectedView, set);
							}
						}
					}
				}
			}

			// #2 : calculate and update merged camera positions
			/** @type {Set<Set<symbol>>} */
			const computed = new Set();
			for (const set of sets.values()) {
				if (computed.has(set)) continue;
				let mass = 0, sumX = 0, sumY = 0, weight = 0;
				if (settings.mergeCamera) {
					for (const view of set) {
						const camera = /** @type {SingleCamera} */ (cameras.get(view));
						mass += camera.mass;
						sumX += camera.sumX;
						sumY += camera.sumY;
						weight += camera.weight;
					}
				}

				for (const view of set) {
					const vision = /** @type {Vision} */ (world.views.get(view));

					if (!settings.mergeCamera) {
						({ mass, sumX, sumY, weight } = /** @type {SingleCamera} */ (cameras.get(view)));
					}

					let xyFactor;
					if (weight <= 0) {
						xyFactor = 20;
					} else if (settings.cameraMovement === 'instant') {
						xyFactor = 1;
					} else {
						// when spawning, move camera quickly (like vanilla), then make it smoother after a bit
						const aliveFor = (performance.now() - vision.spawned) / 1000;
						const a = Math.min(Math.max((aliveFor - 0.3) / 0.3, 0), 1);
						const base = settings.cameraSpawnAnimation ? 2 : 1;
						xyFactor = Math.min(settings.cameraSmoothness, base * (1-a) + settings.cameraSmoothness * a);
					}

					if (weight > 0) {
						vision.camera.tx = sumX / weight;
						vision.camera.ty = sumY / weight;
						let scale;
						if (settings.camera === 'default') scale = /** @type {SingleCamera} */ (cameras.get(view)).scale;
						else scale = Math.min(64 / Math.sqrt(100 * mass), 1) ** 0.4;
						vision.camera.tscale = settings.autoZoom ? scale : 0.25;
					}

					const dt = (now - vision.camera.updated) / 1000;
					vision.camera.x = aux.exponentialEase(vision.camera.x, vision.camera.tx, xyFactor, dt);
					vision.camera.y = aux.exponentialEase(vision.camera.y, vision.camera.ty, xyFactor, dt);
					vision.camera.scale
						= aux.exponentialEase(vision.camera.scale, input.zoom * vision.camera.tscale, 9, dt);
					vision.camera.merged = set.size > 1;
					vision.camera.updated = now;
				}

				computed.add(set);
			}
		};

		/** @param {symbol} view */
		world.create = view => {
			const old = world.views.get(view);
			if (old) return old;

			const vision = {
				border: undefined,
				camera: { x: 0, tx: 0, y: 0, ty: 0, scale: 0, tscale: 0, merged: false, updated: performance.now() - 1 },
				leaderboard: [],
				owned: new Set(),
				spawned: -Infinity,
				stats: undefined,
				used: -Infinity,
			};
			world.views.set(view, vision);
			return vision;
		};

		let wasFlawlessSynchronized = false;
		/** @type {number | undefined} */
		let disagreementAt, disagreementStart;
		world.synchronized = false;
		world.merge = () => {
			if (wasFlawlessSynchronized && settings.synchronization !== 'flawless') {
				for (const key of /** @type {const} */ (['cells', 'pellets'])) {
					for (const cell of world[key].values()) {
						for (const record of cell.views.values()) record.frames.length = 1;
					}
				}
			}

			if (!settings.synchronization || world.views.size <= 1) {
				disagreementStart = disagreementAt = undefined;
				world.synchronized = false;
				wasFlawlessSynchronized = false;
				return;
			}

			const now = performance.now();
			/** @type {{ [x: number | symbol]: number }} indexed by viewInt or symbol view */
			const indices = {};

			if (settings.synchronization === 'flawless') {
				// #1 : set up bipartite graphs between every pair of views
				/** @type {Map<symbol, number>} */
				const viewToInt = new Map();
				/** @type {Map<number, symbol>} */
				const intToView = new Map();
				for (const view of world.views.keys()) {
					intToView.set(viewToInt.size, view);
					viewToInt.set(view, viewToInt.size);
				}
				const viewDim = viewToInt.size;

				// each pair of views (view1, view2, where view1Int < view2Int) has a 12x12 graph, where
				// graph[i * viewDim + j] describes the existence of an undirected connection between index i on view1
				// and index j on view2.
				const COMPATIBLE = 1 << 0;
				const INCOMPATIBLE = 1 << 1;
				const graphDim = 12; // same as maximum history size
				/** @type {Map<number, Uint8Array>} */
				const graphs = new Map();
				for (let i = 0; i < viewToInt.size; ++i) {
					for (let j = i + 1; j < viewToInt.size; ++j) {
						graphs.set(i * viewDim + j, new Uint8Array(graphDim * graphDim));
					}
				}

				// #2 : establish relationships in every graph
				// pellets never change, so it would be useless to try and compare them
				for (const cell of world.cells.values()) {
					for (const view1 of cell.views.keys()) {
						const record1 = /** @type {CellRecord} */ (cell.views.get(view1));
						for (const view2 of cell.views.keys()) {
							if (view1 === view2) continue;
							const record2 = /** @type {CellRecord} */ (cell.views.get(view2));

							const view1Int = /** @type {number} */ (viewToInt.get(view1));
							const view2Int = /** @type {number} */ (viewToInt.get(view2));
							if (view1Int > view2Int) continue; // only access graphs where view1 < view2
							const graph = /** @type {Uint8Array} */ (graphs.get(view1Int * viewDim + view2Int));

							for (let i = 0; i < record1.frames.length; ++i) {
								const frame1 = record1.frames[i];
								for (let j = 0; j < record2.frames.length; ++j) {
									const frame2 = record2.frames[j];

									if (frame1.deadAt !== undefined || frame2.deadAt !== undefined || (frame1.nx === frame2.nx && frame1.ny === frame2.ny && frame1.nr === frame2.nr)) {
										graph[i * graphDim + j] |= COMPATIBLE;
									} else {
										graph[i * graphDim + j] |= INCOMPATIBLE;
									}
								}
							}
						}
					}
				}

				// #3 : find the lowest indices across all views that are compatible with each other
				/**
				 * @param {{ viewInt: number, i: number }[]} previous
				 * @param {number} viewInt
				 * @param {number} i
				 * @returns {boolean}
				 */
				const explore = (previous, viewInt, i) => {
					// try and find the next view that is compatible
					for (let next = viewInt + 1; next < viewDim; ++next) {
						if (indices[next] !== undefined) continue;

						const graph = /** @type {Uint8Array} */ (graphs.get(viewInt * viewDim + next));
						let incompatible = false;
						for (let j = 0; j < graphDim; ++j) {
							const con = graph[i * graphDim + j];
							if (con & INCOMPATIBLE) {
								incompatible = true;
							} else if (con & COMPATIBLE) {
								// we found a connection
								// TODO: checking for backwards compatibility seems to break things
								previous.push({ viewInt, i });
								const ok = explore(previous, next, j);
								previous.pop();
								if (ok) {
									indices[next] = indices[/** @type {symbol} */ (intToView.get(next))] = j;
									return true;
								}

								incompatible = false;
							} else; // don't do anything if the connection is undefined
						}

						// if an incompatible connection was found with no other good choices, then there is a conflict
						// and don't allow it
						if (incompatible) return false;
					}

					return true;
				};

				startCluster: for (let viewInt = 0; viewInt < viewDim; ++viewInt) {
					if (indices[viewInt] !== undefined) continue; // don't re-process a cluster

					// try and start a cluster with some index
					for (let i = 0; i < graphDim; ++i) {
						if (explore([], viewInt, i)) {
							indices[viewInt] = indices[/** @type {symbol} */ (intToView.get(viewInt))] = i;
							continue startCluster;
						}
					}

					// if everything is incompatible, then there is a disagreement somewhere
					// (shouldn't really happen unless a huge lag spike hits)
					disagreementStart ??= now;
					disagreementAt = now;
					if (now - disagreementStart > 1000) world.synchronized = false;
					return;
				}

				wasFlawlessSynchronized = true;
			} else { // settings.synchronization === 'latest'
				let i = 0;
				for (const view of world.views.keys()) indices[i++] = indices[view] = 0;

				wasFlawlessSynchronized = false;
			}

			// #4 : find a model frame for all cells and pellets
			for (const key of /** @type {const} */ (['cells', 'pellets'])) {
				for (const cell of world[key].values()) {
					/** @type {[symbol, CellRecord] | undefined} */
					let modelPair;
					modelViewLoop: for (const pair of cell.views) {
						if (!modelPair) {
							modelPair = pair;
							continue;
						}

						const [modelView, model] = modelPair;
						const [view, record] = pair;

						const modelFrame = model.frames[indices[modelView]];
						const frame = record.frames[indices[view]];

						const modelDisappeared = !modelFrame || (modelFrame.deadAt !== undefined && modelFrame.deadTo === -1);
						const thisDisappeared = !frame || (frame.deadAt !== undefined && frame.deadTo === -1);

						if (modelDisappeared && thisDisappeared) {
							// both have currently disappeared; prefer the one that "disappeared" later
							if (settings.synchronization === 'flawless') {
								for (let off = 1; off < 12; ++off) {
									const modelFrameOffset = model.frames[indices[modelView] + off];
									const frameOffset = record.frames[indices[view] + off];

									const modelOffsetAlive = modelFrameOffset && modelFrameOffset.deadAt === undefined;
									const frameOffsetAlive = frameOffset && frameOffset.deadAt === undefined;
									if (modelOffsetAlive && frameOffsetAlive) {
										// both disappeared at the same time, doesn't matter
										continue modelViewLoop;
									} else if (modelOffsetAlive && !frameOffsetAlive) {
										// model disappeared last, so prefer it
										continue modelViewLoop;
									} else if (!modelOffsetAlive && frameOffsetAlive) {
										// current disappeared last, so prefer it
										modelPair = pair;
										continue modelViewLoop;
									} else; // we haven't found when either one disappeared
								}
							} else {
								// if (!modelFrame && !frame) leave the model as is
								// else if (modelFrame && !frame) leave the model as is
								if (!modelFrame && frame) modelPair = pair;
								else if (modelFrame && frame && /** @type {number} */ (frame.deadAt) > /** @type {number} */ (modelFrame.deadAt)) modelPair = pair;
							}
						} else if (modelDisappeared && !thisDisappeared) {
							// current is the only one visible, so prefer it
							modelPair = pair;
						} else if (!modelDisappeared && thisDisappeared) {
							// model is the only one visible, so prefer it (don't change anything)
						} else; // both are visible and synchronized, so it doesn't matter
					}

					// in very rare circumstances, this ends up being undefined, for some reason
					if (modelPair) cell.model = modelPair[1].frames[indices[modelPair[0]]] ?? cell.model;
				}
			}

			// #5 : create or update the merged frame for all cells and pellets
			for (const key of /** @type {const} */ (['cells', 'pellets'])) {
				for (const cell of world[key].values()) {
					const { model, merged } = cell;
					if (!model) { // could happen
						cell.merged = undefined;
						continue;
					}

					if (!merged || (merged.deadAt !== undefined && model.deadAt === undefined)) {
						cell.merged = {
							nx: model.nx, ny: model.ny, nr: model.nr,
							born: now, deadAt: model.deadAt !== undefined ? now : undefined, deadTo: model.deadTo,
							ox: model.nx, oy: model.ny, or: model.nr,
							jr: model.nr, a: 0, updated: now,
						};
					} else {
						if (merged.deadAt === undefined && (model.deadAt !== undefined || model.nx !== merged.nx || model.ny !== merged.ny || model.nr !== merged.nr)) {
							const xyr = world.xyr(merged, merged, undefined, undefined, key === 'pellets', now);

							merged.ox = xyr.x;
							merged.oy = xyr.y;
							merged.or = xyr.r;
							merged.jr = xyr.jr;
							merged.a = xyr.a;
							merged.updated = now;
						}

						merged.nx = model.nx;
						merged.ny = model.ny;
						merged.nr = model.nr;
						merged.deadAt = model.deadAt !== undefined ? (merged.deadAt ?? now) : undefined;
						merged.deadTo = model.deadTo;
					}
				}
			}

			// #6 : clean up history for all cells, because we don't want to ever go back in time
			for (const key of /** @type {const} */ (['cells', 'pellets'])) {
				for (const cell of world[key].values()) {
					for (const [view, record] of cell.views) {
						// leave the current frame, because .frames must have at least one element
						if (record.frames.length > indices[view] + 1) record.frames.length = indices[view] + 1;
					}
				}
			}

			disagreementStart = undefined;
			// if there ever a disagreement that caused synchronization to be disabled, wait a bit after things
			// resolve to make sure they stay resolved
			if (disagreementAt === undefined || now - disagreementAt > 1000) world.synchronized = true;
		};

		/** @param {symbol} view */
		world.score = view => {
			let score = 0;
			for (const id of (world.views.get(view)?.owned ?? [])) {
				const cell = world.cells.get(id);
				const frame = world.synchronized ? cell?.merged : cell?.views.get(view)?.frames[0];
				if (!frame || frame.deadAt !== undefined) continue;
				score += frame.nr * frame.nr / 100; // use exact score as given by the server, no interpolation
			}

			return score;
		};

		/**
		 * @param {CellFrame} frame
		 * @param {CellInterpolation} interp
		 * @param {CellFrame | undefined} killerFrame
		 * @param {CellInterpolation | undefined} killerInterp
		 * @param {boolean} pellet
		 * @param {number} now
		 * @returns {{ x: number, y: number, r: number, jr: number, a: number }}
		 */
		world.xyr = (frame, interp, killerFrame, killerInterp, pellet, now) => {
			let nx = frame.nx;
			let ny = frame.ny;
			if (killerFrame && killerInterp) {
				// animate towards the killer's interpolated position (not the target position) for extra smoothness
				// we also assume the killer has not died (if it has, then weird stuff is OK to occur)
				const killerXyr = world.xyr(killerFrame, killerInterp, undefined, undefined, false, now);
				nx = killerXyr.x;
				ny = killerXyr.y;
			}

			let x = nx, y = ny, r = frame.r, a = 1;
			if (!pellet || frame.deadAt !== undefined) {
				let alpha = (now - interp.updated) / settings.drawDelay;
				alpha = alpha < 0 ? 0 : alpha > 1 ? 1 : alpha;

				// TODO: why are we not using aux.exponentialEase?
				x = interp.ox + (nx - interp.ox) * alpha;
				y = interp.oy + (ny - interp.oy) * alpha;
				r = interp.or + (frame.nr - interp.or) * alpha;

				const targetA = frame.deadAt !== undefined ? 0 : 1;
				a = interp.a + (targetA - interp.a) * alpha;
			}

			const dt = (now - interp.updated) / 1000;

			return {
				x, y, r,
				jr: aux.exponentialEase(interp.jr, r, settings.slowerJellyPhysics ? 10 : 5, dt),
				a,
			};
		};

		// clean up dead, invisible cells ONLY before uploading pellets
		let lastClean = performance.now();
		world.clean = () => {
			const now = performance.now();
			if (now - lastClean < 200) return;
			lastClean = now;

			for (const key of /** @type {const} */ (['cells', 'pellets'])) {
				for (const [id, cell] of world[key]) {
					for (const [view, record] of cell.views) {
						const firstFrame = record.frames[0];
						const lastFrame = record.frames[record.frames.length - 1];
						if (firstFrame.deadAt !== lastFrame.deadAt) continue;
						if (lastFrame.deadAt !== undefined && now - lastFrame.deadAt >= settings.drawDelay + 200)
							cell.views.delete(view);
					}

					if (cell.views.size === 0) world[key].delete(id);
				}
			}
		};

		world.stats = { foodEaten: 0, highestPosition: 200, highestScore: 0, spawnedAt: undefined };

		return world;
	})();



	//////////////////////////
	// Setup All Networking //
	//////////////////////////
	const net = (() => {
		const net = {};

		// #1 : define state
		/** @type {Map<symbol, {
		 * 	handshake: { shuffle: Uint8Array, unshuffle: Uint8Array } | undefined,
		 * 	latency: number | undefined,
		 * 	pinged: number | undefined,
		 * 	playBlock: { state: 'leaving' | 'joining', started: number } | undefined,
		 * 	rejections: number,
		 * 	retries: number,
		 * 	ws: WebSocket | undefined,
		 * }>} */
		net.connections = new Map();

		/** @param {symbol} view */
		net.create = view => {
			if (net.connections.has(view)) return;

			net.connections.set(view, {
				handshake: undefined,
				latency: undefined,
				pinged: undefined,
				playBlock: undefined,
				rejections: 0,
				retries: 0,
				ws: connect(view),
			});
		};

		let captchaPostQueue = Promise.resolve();

		/**
		 * @param {symbol} view
		 * @param {(() => void)=} establishedCallback
		 * @returns {WebSocket | undefined}
		*/
		const connect = (view, establishedCallback) => {
			if (net.connections.get(view)?.ws) return; // already being handled by another process

			// do not allow sigmod's args[0].includes('sigmally.com') check to pass
			const realUrl = net.url();
			const fakeUrl = /** @type {any} */ ({ includes: () => false, toString: () => realUrl });
			let ws;
			try {
				ws = new WebSocket(fakeUrl);
			} catch (err) {
				console.error('can\'t make WebSocket:', err);
				aux.require(null, 'The server address is invalid. It probably has a typo.\n' +
					'- If using an insecure address (starting with "ws://" and not "wss://") that isn\'t localhost, ' +
					'enable Insecure Content in this site\'s browser settings.\n' +
					'- If using a local server, make sure to use localhost and not any other local IP.');
				return; // ts-check is dumb
			}
			if (net.connections.get(view)) net.connections.get(view).ws = ws;

			ws.binaryType = 'arraybuffer';
			ws.addEventListener('close', e => {
				console.error('WebSocket closed:', e);
				establishedCallback?.(); // TODO what does establishedCallback even do?
				establishedCallback = undefined;

				const connection = net.connections.get(view);
				const vision = world.views.get(view);
				if (!connection || !vision) return; // if the entry no longer exists, don't reconnect

				connection.handshake = undefined;
				connection.latency = undefined;
				connection.pinged = undefined;
				connection.playBlock = undefined;
				++connection.rejections;
				if (connection.retries > 0) --connection.retries;

				vision.border = undefined;
				// don't reset vision.camera
				vision.owned = new Set();
				vision.leaderboard = [];
				vision.spawned = -Infinity;
				vision.stats = undefined;

				for (const key of /** @type {const} */ (['cells', 'pellets'])) {
					for (const [id, resolution] of world[key]) {
						resolution.views.delete(view);
						if (resolution.views.size === 0) world[key].delete(id);
					}
				}

				connection.ws = undefined;
				world.merge();
				render.upload(true);

				const thisUrl = net.url();
				const url = new URL(thisUrl); // use the current url, not realUrl
				const captchaEndpoint = `http${url.protocol === 'ws:' ? '' : 's'}://${url.host}/server/recaptcha/v3`;

				/** @param {string} type */
				const requestCaptcha = type => {
					ui.captcha.request(view, type, token => {
						captchaPostQueue = captchaPostQueue.then(() => new Promise(resolve => {
							aux.oldFetch(captchaEndpoint, {
								method: 'POST',
								headers: { 'content-type': 'application/json' },
								body: JSON.stringify({ token }),
							}).then(res => res.json()).then(res => res.status).catch(() => 'rejected')
								.then(status => {
									if (status === 'complete') connect(view, resolve);
									else setTimeout(() => connect(view, resolve), 1000);
								});
						}));
					});
				};

				if (connection.retries > 0) {
					setTimeout(() => connect(view), 500);
				} else {
					aux.oldFetch(captchaEndpoint).then(res => res.json()).then(res => res.version).catch(() => 'none')
						.then(type => {
							connection.retries = 3;
							if (type === 'v2' || type === 'v3' || type === 'turnstile') requestCaptcha(type);
							else setTimeout(() => connect(view), connection.rejections >= 5 ? 5000 : 500);
						});
				}
			});
			ws.addEventListener('error', () => {});
			ws.addEventListener('message', e => {
				const connection = net.connections.get(view);
				const vision = world.views.get(view);
				if (!connection || !vision) return ws.close();
				const dat = new DataView(e.data);

				if (!connection.handshake) {
					// skip version "SIG 0.0.1\0"
					let o = 10;

					const shuffle = new Uint8Array(256);
					const unshuffle = new Uint8Array(256);
					for (let i = 0; i < 256; ++i) {
						const shuffled = dat.getUint8(o + i);
						shuffle[i] = shuffled;
						unshuffle[shuffled] = i;
					}
					connection.handshake = { shuffle, unshuffle };

					if (world.alive()) net.play(world.selected, input.playData(input.name(view), false));
					return;
				}

				// do this so the packet can easily be sent to sigmod afterwards
				dat.setUint8(0, connection.handshake.unshuffle[dat.getUint8(0)]);

				const now = performance.now();
				let o = 1;
				switch (dat.getUint8(0)) {
					case 0x10: { // world update
						// carry forward record frames
						if (settings.synchronization === 'flawless') {
							for (const key of /** @type {const} */ (['cells', 'pellets'])) {
								for (const cell of world[key].values()) {
									const record = cell.views.get(view);
									if (!record) continue;

									record.frames.unshift(record.frames[0]);
									if (record.frames.length > 12) record.frames.length = 12;
								}
							}
						}

						// (a) : eat
						const killCount = dat.getUint16(o, true);
						o += 2;
						for (let i = 0; i < killCount; ++i) {
							const killerId = dat.getUint32(o, true);
							const killedId = dat.getUint32(o + 4, true);
							o += 8;

							let pellet = true;
							let killed = world.pellets.get(killedId) ?? (pellet = false, world.cells.get(killedId));
							const record = killed?.views.get(view);
							if (!record) continue;

							const frame = record.frames[0];
							// update interpolation using old targets
							const xyr = world.xyr(record.frames[0], record, undefined, undefined, pellet, now);
							record.ox = xyr.x;
							record.oy = xyr.y;
							record.or = xyr.r;
							record.jr = xyr.jr;
							record.a = xyr.a;
							record.updated = now;

							// update new targets (and dead-ness)
							record.frames[0] = {
								nx: frame.nx, ny: frame.ny, nr: frame.nr,
								born: frame.born, deadAt: now, deadTo: killerId,
							};

							if (pellet && vision.owned.has(killerId)) {
								++world.stats.foodEaten;
								net.food(view); // dumbass quest code go brrr
							}
						}

						// (b) : add, upd
						do {
							const id = dat.getUint32(o, true);
							o += 4;
							if (id === 0) break;

							const x = dat.getInt16(o, true);
							const y = dat.getInt16(o + 2, true);
							const r = dat.getUint16(o + 4, true);
							const flags = dat.getUint8(o + 6);
							const sub = !!dat.getUint8(o + 9);
							o += 10;

							let clan; [clan, o] = aux.readZTString(dat, o);

							/** @type {[number, number, number] | undefined} */
							let rgb;
							if (flags & 0x02) { // update color
								rgb = [dat.getUint8(o++) / 255, dat.getUint8(o++) / 255, dat.getUint8(o++) / 255];
							}

							/** @type {string | undefined} */
							let skin;
							if (flags & 0x04) { // update skin
								[skin, o] = aux.readZTString(dat, o);
								skin = aux.parseSkin(skin);
							}

							/** @type {string | undefined} */
							let name;
							if (flags & 0x08) { // update name
								[name, o] = aux.readZTString(dat, o);
								name = aux.parseName(name);
								if (name) render.textFromCache(name, sub); // make sure the texture is ready on render
							}

							const jagged = !!(flags & 0x11); // spiked or agitated
							const eject = !!(flags & 0x20);
							const pellet = r <= 40 && !eject; // tourney servers have bigger pellets (r=40)
							const cell = (pellet ? world.pellets : world.cells).get(id);
							const record = cell?.views.get(view);
							if (record) {
								const frame = record.frames[0];
								if (frame.deadAt === undefined) {
									// update interpolation using old targets
									const xyr = world.xyr(record.frames[0], record, undefined, undefined, pellet, now);
									record.ox = xyr.x;
									record.oy = xyr.y;
									record.or = xyr.r;
									record.jr = xyr.jr;
									record.a = xyr.a;
								} else {
									// cell just reappeared, discard all old data
									record.ox = x;
									record.oy = y;
									record.or = r;
									record.jr = r;
									record.a = 0;
								}

								record.updated = now;

								// update target frame
								record.frames[0] = {
									nx: x, ny: y, nr: r,
									born: frame.born, deadAt: undefined, deadTo: -1
								};

								// update desc
								if (name !== undefined) record.name = name;
								if (skin !== undefined) record.skin = skin;
								if (rgb !== undefined) record.rgb = rgb;
								record.clan = clan;
								record.jagged = jagged;
								record.eject = eject;
							} else {
								/** @type {CellRecord} */
								const record = {
									ox: x, oy: y, or: r,
									jr: r, a: 0, updated: now,
									frames: [{
										nx: x, ny: y, nr: r,
										born: now, deadAt: undefined, deadTo: -1,
									}],
									name: name ?? '', skin: skin ?? '', sub, clan,
									rgb: rgb ?? [0.5, 0.5, 0.5],
									jagged, eject,
								};
								if (cell) {
									cell.views.set(view, record);
								} else {
									(pellet ? world.pellets : world.cells).set(id, {
										id,
										merged: undefined,
										model: undefined,
										views: new Map([[ view, record ]]),
									});
								}

								if (settings.synchronization === 'latest' && !pellet && !eject && rgb) {
									// 'latest' requires us to predict which cells we will own
									// a name + color check should be enough
									/** @type {CellDescription | undefined} */
									let base;
									for (const id of vision.owned) {
										const desc = world.cells.get(id)?.views.get(view);
										if (!desc || desc.frames[0].deadAt !== undefined) continue;
										base = desc;
										break;
									}

									if (base && name === base.name && rgb[0] === base.rgb[0] && rgb[1] === base.rgb[1] && rgb[2] === base.rgb[2]) {
										vision.owned.add(id);
									}
								}
							}
						} while (true);

						// (c) : del
						const deleteCount = dat.getUint16(o, true);
						o += 2;
						for (let i = 0; i < deleteCount; ++i) {
							const deletedId = dat.getUint32(o, true);
							o += 4;

							const record
								= (world.pellets.get(deletedId) ?? world.cells.get(deletedId))?.views.get(view);
							const frame = record?.frames[0];
							if (frame?.deadAt !== undefined) continue;
							record.frames[0] = {
								nx: frame.nx, ny: frame.ny, nr: frame.nr,
								born: frame.born, deadAt: now, deadTo: -1,
							};
							// no interpolation stuff is updated because the target positions won't be changed,
							// unlike on eat where nx and ny are set to the killer's
						}

						// (d) : finalize, upload data
						world.merge();
						world.clean();
						render.upload(true);

						// (e) : clear own cells that don't exist anymore (NOT on world.clean!)
						for (const id of vision.owned) {
							const cell = world.cells.get(id);
							if (!cell) {
								vision.owned.delete(id);
								continue;
							}
							const record = cell?.views.get(view);

							if (record && record.frames[0].deadAt === undefined && connection.playBlock?.state === 'joining') {
								connection.playBlock = undefined;
							}
						}

						ui.deathScreen.check();
						break;
					}

					case 0x11: { // update camera pos
						vision.camera.tx = dat.getFloat32(o, true);
						vision.camera.ty = dat.getFloat32(o + 4, true);
						vision.camera.tscale = dat.getFloat32(o + 8, true);
						break;
					}

					case 0x12: { // delete all cells
						// happens every time you respawn
						if (connection.playBlock?.state === 'leaving') connection.playBlock.state = 'joining';
						// the server won't respond to pings if you aren't in a world, and we don't want to show '????'
						// unless there's actually a problem
						connection.pinged = undefined;

						// DO NOT just clear the maps! when respawning, OgarII will not resend cell data if we spawn
						// nearby.
						for (const key of /** @type {const} */ (['cells', 'pellets'])) {
							for (const cell of world[key].values()) {
								const record = cell.views.get(view);
								if (!record) continue;

								const frame = record.frames[0];
								if (settings.synchronization === 'flawless') {
									record.frames.unshift({
										nx: frame.nx, ny: frame.ny, nr: frame.nr,
										born: frame.born, deadAt: frame.deadAt ?? now, deadTo: frame.deadTo || -1,
									});
								} else {
									const frameWritable = /** @type {CellFrameWritable} */ (frame);
									frameWritable.deadAt ??= now;
									frameWritable.deadTo ||= -1;
								}
							}
						}
						world.merge();
						render.upload(true);
						// passthrough
					}
					case 0x14: { // delete my cells
						// only reset spawn time if no other tab is alive.
						// this could be cheated (if you alternate respawning your tabs, for example) but i don't think
						// multiboxers ever see the stats menu anyway
						if (!world.alive()) world.stats.spawnedAt = undefined;
						ui.deathScreen.hide(); // don't trigger death screen on respawn
						break;
					}

					case 0x20: { // new owned cell
						// check if this is the first owned cell
						let first = true;
						let firstThis = true;
						for (const [otherView, otherVision] of world.views) {
							for (const id of otherVision.owned) {
								const frame = world.cells.get(id)?.views.get(otherView)?.frames[0];
								if (frame.deadAt !== undefined) continue;

								first = false;
								if (otherVision === vision) {
									firstThis = false;
									break;
								}
							}
						}
						if (first) world.stats.spawnedAt = now;
						if (firstThis) vision.spawned = now;

						vision.owned.add(dat.getUint32(o, true));
						break;
					}

					case 0x31: { // ffa leaderboard list
						const lb = [];
						const count = dat.getUint32(o, true);
						o += 4;

						/** @type {number | undefined} */
						let myPosition;
						for (let i = 0; i < count; ++i) {
							const me = !!dat.getUint32(o, true);
							o += 4;

							let name; [name, o] = aux.readZTString(dat, o);
							name = aux.parseName(name);

							// why this is copied into every leaderboard entry is beyond my understanding
							myPosition = dat.getUint32(o, true);
							const sub = !!dat.getUint32(o + 4, true);
							o += 8;

							lb.push({ name, sub, me, place: undefined });
						}

						if (myPosition) { // myPosition could be zero
							if (myPosition - 1 >= lb.length) {
								const nick = input.nick[world.multis.indexOf(view) || 0].value;
								lb.push({
									me: true,
									name: aux.parseName(nick),
									place: myPosition,
									sub: false, // doesn't matter
								});
							}

							world.stats.highestPosition = Math.min(world.stats.highestPosition, myPosition);
						}

						vision.leaderboard = lb;
						break;
					}

					case 0x40: { // border update
						vision.border = {
							l: dat.getFloat64(o, true),
							t: dat.getFloat64(o + 8, true),
							r: dat.getFloat64(o + 16, true),
							b: dat.getFloat64(o + 24, true),
						};
						break;
					}

					case 0x63: { // chat message
						// only handle non-server chat messages on the primary tab, to prevent duplicate messages
						const flags = dat.getUint8(o++);
						const server = flags & 0x80;
						if (view !== world.viewId.primary && !server) return; // skip sigmod processing too
						const rgb = /** @type {[number, number, number, number]} */
							([dat.getUint8(o++) / 255, dat.getUint8(o++) / 255, dat.getUint8(o++) / 255, 1]);

						let name; [name, o] = aux.readZTString(dat, o);
						let msg; [msg, o] = aux.readZTString(dat, o);
						ui.chat.add(name, rgb, msg, !!(flags & 0x80));
						break;
					}

					case 0xb4: { // incorrect password alert
						ui.error('Password is incorrect');
						break;
					}

					case 0xfe: { // server stats (in response to a ping)
						let statString; [statString, o] = aux.readZTString(dat, o);
						vision.stats = JSON.parse(statString);
						if (connection.pinged !== undefined) connection.latency = now - connection.pinged;
						connection.pinged = undefined;
						break;
					}
				}

				sigmod.handleMessage?.(dat);
			});
			ws.addEventListener('open', () => {
				establishedCallback?.();
				establishedCallback = undefined;

				const connection = net.connections.get(view);
				const vision = world.views.get(view);
				if (!connection || !vision) return ws.close();

				ui.captcha.remove(view);

				connection.rejections = 0;
				connection.retries = 0;

				vision.camera.x = vision.camera.tx = 0;
				vision.camera.y = vision.camera.ty = 0;
				vision.camera.scale = input.zoom;
				vision.camera.tscale = 1;
				ws.send(aux.textEncoder.encode('SIG 0.0.1\x00'));
			});

			return ws;
		};

		// ping loop
		setInterval(() => {
			for (const connection of net.connections.values()) {
				if (!connection.handshake || connection.ws?.readyState !== WebSocket.OPEN) continue;
				if (connection.pinged !== undefined) connection.latency = -1; // display '????ms'
				connection.pinged = performance.now();
				connection.ws.send(connection.handshake.shuffle.slice(0xfe, 0xfe + 1));
			}
		}, 2000);

		// #2 : define helper functions
		/** @type {HTMLSelectElement | null} */
		const gamemode = document.querySelector('#gamemode');
		/** @type {HTMLOptionElement | null} */
		const firstGamemode = document.querySelector('#gamemode option');
		net.url = () => {
			if (location.search.startsWith('?ip=')) return location.search.slice('?ip='.length);
			else return 'wss://' + (gamemode?.value || firstGamemode?.value || 'ca0.sigmally.com/ws/');
		};

		/** @param {symbol} view */
		net.respawnable = view => {
			const vision = world.views.get(view);
			const con = net.connections.get(view);
			if (!vision || !con?.ws) return false;

			// only allow respawns on localhost (players on personal private servers can simply append `localhost`)
			return world.score(view) < 5500 || con.ws.url.includes('localhost');
		};

		// disconnect if a different gamemode is selected
		// an interval is preferred because the game can apply its gamemode setting *after* connecting without
		// triggering any events
		setInterval(() => {
			for (const connection of net.connections.values()) {
				if (!connection.ws) continue;
				if (connection.ws.readyState !== WebSocket.CONNECTING && connection.ws.readyState !== WebSocket.OPEN)
					continue;
				if (connection.ws.url === net.url()) continue;
				connection.ws.close();
			}
		}, 200);

		/**
		 * @param {symbol} view
		 * @param {number} opcode
		 * @param {object} data
		 */
		const sendJson = (view, opcode, data) => {
			// must check readyState as a weboscket might be in the 'CLOSING' state (so annoying!)
			const connection = net.connections.get(view);
			if (!connection?.handshake || connection.ws?.readyState !== WebSocket.OPEN) return;
			const dataBuf = aux.textEncoder.encode(JSON.stringify(data));
			const dat = new DataView(new ArrayBuffer(dataBuf.byteLength + 2));

			dat.setUint8(0, connection.handshake.shuffle[opcode]);
			for (let i = 0; i < dataBuf.byteLength; ++i) dat.setUint8(1 + i, dataBuf[i]);
			connection.ws.send(dat);
		};

		// #5 : export input functions
		/**
		 * @param {symbol} view
		 * @param {number} x
		 * @param {number} y
		 */
		net.move = (view, x, y) => {
			const connection = net.connections.get(view);
			if (!connection?.handshake || connection.ws?.readyState !== WebSocket.OPEN) return;
			const dat = new DataView(new ArrayBuffer(13));

			dat.setUint8(0, connection.handshake.shuffle[0x10]);
			dat.setInt32(1, x, true);
			dat.setInt32(5, y, true);
			connection.ws.send(dat);
		};

		/** @param {number} opcode */
		const bindOpcode = opcode => /** @param {symbol} view */ view => {
			const connection = net.connections.get(view);
			if (!connection?.handshake || connection.ws?.readyState !== WebSocket.OPEN) return;
			connection.ws.send(connection.handshake.shuffle.slice(opcode, opcode + 1));
		};
		net.w = bindOpcode(21);
		net.qdown = bindOpcode(18);
		net.qup = bindOpcode(19);
		net.split = bindOpcode(17);
		// quests
		net.food = bindOpcode(0xc0);
		net.time = bindOpcode(0xbf);

		// reversed argument order for sigmod compatibility
		/**
		 * @param {string} msg
		 * @param {symbol=} view
		 */
		net.chat = (msg, view = world.selected) => {
			const connection = net.connections.get(view);
			if (!connection?.handshake || connection.ws?.readyState !== WebSocket.OPEN) return;

			if (msg.toLowerCase().startsWith('/leaveworld') && !net.respawnable(view)) return; // prevent abuse

			const msgBuf = aux.textEncoder.encode(msg);
			const dat = new DataView(new ArrayBuffer(msgBuf.byteLength + 3));

			dat.setUint8(0, connection.handshake.shuffle[0x63]);
			// flags = 0
			for (let i = 0; i < msgBuf.byteLength; ++i) dat.setUint8(2 + i, msgBuf[i]);
			connection.ws.send(dat);
		};

		/**
		 * @param {symbol} view
		 * @param {{ name: string, skin: string, [x: string]: any }} data
		 */
		net.play = (view, data) => {
			const connection = net.connections.get(view);
			const now = performance.now();
			if (!data.state) {
				if (!connection || (connection.playBlock !== undefined && now - connection.playBlock.started < 750) || world.score(view) > 0) return;
				connection.playBlock = { state: 'joining', started: now };
				ui.deathScreen.hide();
			}
			sendJson(view, 0x00, data);
		};

		/**
		 * @param {symbol} view
		 * @param {{ name: string, skin: string, [x: string]: any }} data
		 */
		net.respawn = (view, data) => {
			const connection = net.connections.get(view);
			const now = performance.now();
			if (!connection?.handshake || connection.ws?.readyState !== WebSocket.OPEN) return;
			if (connection.playBlock !== undefined && now - connection.playBlock.started < 750) return;

			const score = world.score(view);
			if (score <= 0) { // if dead, no need to leave+rejoin the world
				net.play(view, data);
				return;
			} else if (!net.respawnable(view)) return;

			if (settings.blockNearbyRespawns) {
				const vision = world.views.get(view);
				if (!vision?.border) return;

				world.cameras(now);
				const { l, r, t, b } = vision.border;

				for (const [otherView, otherVision] of world.views) {
					if (otherView === view || world.score(otherView) <= 0) continue;

					// block respawns if both views are close enough (minimap squares give too large of a threshold)
					const d = Math.hypot(vision.camera.tx - otherVision.camera.tx, vision.camera.ty - otherVision.camera.ty);
					if (d <= Math.min(r - l, b - t) / 4) return;
				}
			}

			connection.playBlock = { state: 'leaving', started: now };
			net.chat('/leaveworld', view); // immediately remove from world, which removes all player cells
			sendJson(view, 0x00, data); // enqueue into matchmaker (/joinworld is not available if dead)
			setTimeout(() => { // wait until Matchmaker.update() puts us into a world
			 	sendJson(view, 0x00, data); // spawn
			}, 60); // = 40ms (1 tick) + 20ms (margin of error)
		};

		// create initial connection
		world.create(world.viewId.primary);
		net.create(world.viewId.primary);
		let lastChangedSpectate = -Infinity;
		setInterval(() => {
			if (!settings.multibox && !settings.nbox) {
				world.selected = world.viewId.primary;
				ui.captcha.reposition();
				ui.linesplit.update();
			}

			if (settings.spectator) {
				const vision = world.create(world.viewId.spectate);
				net.create(world.viewId.spectate);
				net.play(world.viewId.spectate, { name: '', skin: '', clan: aux.userData?.clan, state: 2 });

				// only press Q to toggle once in a while, in case ping is above 200
				const now = performance.now();
				if (now - lastChangedSpectate > 1000) {
					if (vision.camera.tscale > 0.39) { // when roaming, the spectate scale is set to ~0.4
						net.qdown(world.viewId.spectate);
						lastChangedSpectate = now;
					}
				} else {
					net.qup(world.viewId.spectate); // doubly serves as anti-afk
				}
			} else {
				const con = net.connections.get(world.viewId.spectate);
				if (con?.ws && con?.ws.readyState !== WebSocket.CLOSED && con?.ws.readyState !== WebSocket.CLOSING) {
					con?.ws.close();
				}
				net.connections.delete(world.viewId.spectate);
				world.views.delete(world.viewId.spectate);
				input.views.delete(world.viewId.spectate);

				for (const key of /** @type {const} */ (['cells', 'pellets'])) {
					for (const [id, resolution] of world[key]) {
						resolution.views.delete(world.viewId.spectate);
						if (resolution.views.size === 0) world[key].delete(id);
					}
				}
			}
		}, 200);

		// dumbass quest code go brrr
		setInterval(() => {
			for (const view of net.connections.keys()) net.time(view);
		}, 1000);

		return net;
	})();



	//////////////////////////
	// Setup Input Handlers //
	//////////////////////////
	const input = (() => {
		const input = {};

		// #1 : general inputs
		// between -1 and 1
		/** @type {[number, number]} */
		input.current = [0, 0];
		/** @type {Map<symbol, {
		 * 		forceW: boolean,
		 * 		lock: { type: 'point', mouse: [number, number], world: [number, number], until: number }
		 * 			| { type: 'horizontal', world: [number, number], lastSplit: number }
		 * 			| { type: 'vertical', world: [number, number], lastSplit: number }
		 * 			| { type: 'fixed' }
		 * 			| undefined,
		 * 		mouse: [number, number], // between -1 and 1
		 * 		w: boolean,
		 * 		world: [number, number], // world position; only updates when tab is selected
		 * }>} */
		input.views = new Map();
		input.zoom = 1;

		input.nboxSelectedPairs = [world.multis[0], world.multis[2], world.multis[4], world.multis[6]];
		input.nboxSelectedReal = world.viewId.primary;
		/** @type {Set<symbol>} */
		input.nboxSelectedTemporary = new Set();

		/** @param {symbol} view */
		const create = view => {
			const old = input.views.get(view);
			if (old) return old;

			/** @type {typeof input.views extends Map<symbol, infer T> ? T : never} */
			const inputs = { forceW: false, lock: undefined, mouse: [0, 0], w: false, world: [0, 0] };
			input.views.set(view, inputs);
			return inputs;
		};

		/**
		 * @param {symbol} view
		 * @param {[number, number]} x, y
		 * @returns {[number, number]}
		 */
		input.toWorld = (view, [x, y]) => {
			const camera = world.views.get(view)?.camera;
			if (!camera) return [0, 0];
			return [
				camera.x + x * (innerWidth / innerHeight) * 540 / camera.scale,
				camera.y + y * 540 / camera.scale,
			];
		};

		// sigmod freezes the player by overlaying an invisible div, so we just listen for canvas movements instead
		addEventListener('mousemove', e => {
			if (ui.escOverlayVisible()) return;
			// sigmod freezes the player by overlaying an invisible div, so we respect it
			if (e.target instanceof HTMLDivElement
				&& /** @type {CSSUnitValue | undefined} */ (e.target.attributeStyleMap.get('z-index'))?.value === 99)
				return;
			input.current = [(e.clientX / innerWidth * 2) - 1, (e.clientY / innerHeight * 2) - 1];
		});

		const unfocused = () => ui.escOverlayVisible() || document.activeElement?.tagName === 'INPUT';

		/** @param {symbol} view */
		input.name = view => {
			const i = world.multis.indexOf(view);
			if (i <= 0) return input.nick[0]?.value || '';
			else return settings.multiNames[i - 1] || '';
		};

		/**
		 * @param {symbol} view
		 * @param {boolean} forceUpdate
		 */
		input.move = (view, forceUpdate) => {
			const now = performance.now();
			const inputs = input.views.get(view) ?? create(view);
			if (view === world.selected) inputs.mouse = input.current;

			const worldMouse = input.toWorld(view, inputs.mouse);

			switch (inputs.lock?.type) {
				case 'point':
					if (now > inputs.lock.until) break;
					const d = Math.hypot(inputs.mouse[0] - inputs.lock.mouse[0], inputs.mouse[1] - inputs.lock.mouse[1]);
					// only lock the mouse as long as the mouse has not moved further than 25% (of 2) of the screen away
					if (d < 0.5 || Number.isNaN(d)) {
						net.move(view, ...inputs.lock.world);
						return;
					}
					break;
				
				case 'horizontal':
					if (settings.moveAfterLinesplit && inputs.lock.lastSplit !== -Infinity) {
						// move horizontally only after splitting to maximize distance travelled
						if (Math.abs(inputs.mouse[0]) <= 0.2) {
							net.move(view, worldMouse[0], inputs.lock.world[1]);
						} else {
							net.move(view, (2 ** 31 - 1) * (inputs.mouse[0] >= 0 ? 1 : -1), inputs.lock.world[1]);
						}
					} else {
						net.move(view, ...inputs.lock.world);
					}
					return;

				case 'vertical':
					if (settings.moveAfterLinesplit ? inputs.lock.lastSplit !== -Infinity : now - inputs.lock.lastSplit <= 150) {
						// vertical linesplits require a bit of upwards movement to split upwards
						if (Math.abs(inputs.mouse[1]) <= 0.2) {
							net.move(view, inputs.lock.world[0], worldMouse[1]);
						} else {
							net.move(view, inputs.lock.world[0], (2 ** 31 - 1) * (inputs.mouse[1] >= 0 ? 1 : -1));
						}
					} else {
						net.move(view, ...inputs.lock.world);
					}
					return;

				case 'fixed':
					// rotate around the tab's camera center (otherwise, spinning around on a tab feels unnatural)
					const worldCenter = world.singleCamera(view, undefined, settings.camera !== 'default' ? 2 : 0, now);
					const x = worldMouse[0] - worldCenter.sumX / worldCenter.weight;
					const y = worldMouse[1] - worldCenter.sumY / worldCenter.weight;
					// create two points along the 2^31 integer boundary (OgarII uses ~~x and ~~y to truncate positions
					// to 32-bit integers), choose which one is closer to zero (the one actually within the boundary)
					const max = 2 ** 31 - 1;
					const xClamp = /** @type {const} */ ([max * Math.sign(x), y / x * max * Math.sign(x)]);
					const yClamp = /** @type {const} */ ([x / y * max * Math.sign(y), max * Math.sign(y)]);
					if (Math.hypot(...xClamp) < Math.hypot(...yClamp)) net.move(view, ...xClamp);
					else net.move(view, ...yClamp);
					return;
			}

			inputs.lock = undefined;
			if (world.selected === view || forceUpdate) inputs.world = worldMouse;
			net.move(view, ...inputs.world);
		};

		/**
		 * @param {symbol} view
		 * @param {number=} count
		 */
		input.split = (view, count = 1) => {
			const inputs = create(view);
			if (inputs?.lock?.type === 'vertical' || inputs?.lock?.type === 'horizontal') {
				inputs.lock.lastSplit = performance.now();
			}
			input.move(view, true);
			for (let i = 0; i < count; ++i) net.split(view);
		};

		/** @param {symbol} view */
		input.autoRespawn = view => {
			if (!world.alive()) return;
			net.play(world.selected, input.playData(input.name(view), false));
		};

		/**
		 * @param {symbol} view
		 */
		input.tab = view => {
			if (view === world.selected) return;
			const oldView = world.selected;
			const inputs = create(oldView);
			const newInputs = create(view);

			newInputs.w = inputs.w;
			inputs.w = false; // stop current tab from feeding; don't change forceW
			// update mouse immediately (after setTimeout, when mouse events happen)
			setTimeout(() => inputs.world = input.toWorld(oldView, inputs.mouse = input.current));

			world.selected = view;
			world.create(world.selected);
			net.create(world.selected);

			ui.captcha.reposition();
			ui.linesplit.update();
		};

		setInterval(() => {
			create(world.selected);
			for (const [view, inputs] of input.views) {
				input.move(view, false);
				// if tapping W very fast, make sure at least one W is ejected
				if (inputs.forceW || inputs.w) net.w(view);
				inputs.forceW = false;
			}
		}, 40);

		/** @type {Node | null} */
		let sigmodChat;
		setInterval(() => sigmodChat ||= document.querySelector('.modChat'), 500);
		addEventListener('wheel', e => {
			if (unfocused()) return;
			// when scrolling through sigmod chat, don't allow zooming.
			// for consistency, use the container .modChat and not #mod-messages as #mod-messages can have zero height
			if (sigmodChat && sigmodChat.contains(/** @type {Node} */ (e.target))) return;
			// support for the very obscure "scroll by page" setting in windows
			// i don't think browsers support DOM_DELTA_LINE, so assume DOM_DELTA_PIXEL otherwise
			const deltaY = e.deltaMode === e.DOM_DELTA_PAGE ? e.deltaY : e.deltaY / 100;
			input.zoom *= 0.8 ** (deltaY * settings.scrollFactor);
			const minZoom = (!settings.multibox && !settings.nbox && !aux.settings.zoomout) ? 1 : 0.8 ** 15;
			input.zoom = Math.min(Math.max(input.zoom, minZoom), 0.8 ** -21);
		});

		/**
		 * @param {KeyboardEvent | MouseEvent} e
		 * @returns {boolean}
		 */
		const handleKeybind = e => {
			const keybind = aux.keybind(e)?.toLowerCase();
			if (!keybind) return false;

			const release = e.type === 'keyup' || e.type === 'mouseup';
			if (!release && settings.multibox && keybind === settings.multibox.toLowerCase()) {
				e.preventDefault(); // prevent selecting anything on the page

				// cycle to the next tab
				const tabs = settings.nbox ? settings.nboxCount : 2;
				const i = world.multis.indexOf(world.selected);
				const newI = Math.min((i + 1) % tabs, world.multis.length);
				input.nboxSelectedNonTemporary = world.multis[newI];

				input.nboxSelectedTemporary.clear();
				input.nboxSelectedNonTemporary = world.multis[newI];
				input.nboxSelectedPairs[Math.floor(newI / 2)] = world.multis[newI];

				input.tab(world.multis[newI]);
				input.autoRespawn(world.multis[newI]);
				return true;
			}

			if (settings.nbox) {
				if (!release && keybind === settings.nboxSwitchPair.toLowerCase()) {
					const i = world.multis.indexOf(input.nboxSelectedReal);
					const pair = Math.floor(i / 2);
					// don't allow switching in a pair that doesn't exist
					const partner = pair * 2 === i ? (i + 1 < settings.nboxCount ? i + 1 : i) : i - 1;
					input.nboxSelectedReal = input.nboxSelectedPairs[pair] = world.multis[partner];
					input.nboxSelectedTemporary.clear(); // but still clear the temporary holds regardless
					input.tab(world.multis[partner]);
					input.autoRespawn(world.selected);
					return true;
				}

				if (!release && keybind === settings.nboxCyclePair.toLowerCase()) {
					const i = world.multis.indexOf(input.nboxSelectedReal);
					const pair = Math.floor(i / 2);
					const newPair = (pair + 1) % Math.ceil(settings.nboxCount / 2);
					input.nboxSelectedReal = input.nboxSelectedPairs[newPair];
					input.nboxSelectedTemporary.clear();
					input.tab(input.nboxSelectedReal);
					input.autoRespawn(world.selected);
					return true;
				}

				for (let i = 0; i < settings.nboxCount; ++i) {
					if (!release && keybind === settings.nboxSelectKeybinds[i].toLowerCase()) {
						input.nboxSelectedReal = input.nboxSelectedPairs[Math.floor(i / 2)] = world.multis[i];
						input.nboxSelectedTemporary.clear();
						input.tab(world.multis[i]);
						input.autoRespawn(world.selected);
						return true;
					}

					const hold = settings.nboxHoldKeybinds[i].toLowerCase();
					if (keybind === hold || (release && hold.endsWith('+' + keybind))) {
						if (release) {
							input.nboxSelectedTemporary.delete(world.multis[i]);
							if (input.nboxSelectedTemporary.size === 0) input.tab(input.nboxSelectedReal);
						} else {
							input.nboxSelectedTemporary.add(world.multis[i]);
							input.tab(world.multis[i]);
						}
						input.autoRespawn(world.selected);
						return true;
					}
				}
			}

			return false;
		};

		addEventListener('keydown', e => {
			const view = world.selected;
			const inputs = input.views.get(view) ?? create(view);

			// never allow pressing Tab by itself
			if (e.code === 'Tab' && !e.ctrlKey && !e.altKey && !e.metaKey) e.preventDefault();

			if (e.code === 'Escape') {
				if (document.activeElement === ui.chat.input) ui.chat.input.blur();
				else ui.toggleEscOverlay();
				return;
			}

			if (unfocused()) {
				if (e.code === 'Enter' && document.activeElement === ui.chat.input && ui.chat.input.value.length > 0) {
					net.chat(ui.chat.input.value.slice(0, 15), world.selected);
					ui.chat.input.value = '';
					ui.chat.input.blur();
				}

				return;
			}

			if (handleKeybind(e)) return;

			if (settings.blockBrowserKeybinds) {
				if (e.code === 'F11') {
					// force true fullscreen to make sure Ctrl+W and other binds are caught.
					// not well supported on safari
					if (!document.fullscreenElement) {
						document.body.requestFullscreen?.()?.catch(() => {});
						/** @type {any} */ (navigator).keyboard?.lock()?.catch(() => {});
					} else {
						document.exitFullscreen?.()?.catch(() => {});
						/** @type {any} */ (navigator).keyboard?.unlock()?.catch(() => {});
					}
				}

				if (e.code !== 'Tab') e.preventDefault(); // allow ctrl+tab and alt+tab
			} else if (e.ctrlKey && e.code === 'KeyW') {
				e.preventDefault(); // doesn't seem to work for me, but works for others
			}

			// if fast feed is rebound, only allow the spoofed W's from sigmod
			let fastFeeding = e.code === 'KeyW';
			if (sigmod.settings.rapidFeedKey && sigmod.settings.rapidFeedKey !== 'w') {
				fastFeeding &&= !e.isTrusted;
			}
			if (fastFeeding) inputs.forceW = inputs.w = true;

			switch (e.code) {
				case 'KeyQ':
					if (!e.repeat) net.qdown(world.selected);
					break;
				case 'Space': {
					if (!e.repeat) {
						// send mouse position immediately, so the split will go in the correct direction.
						// setTimeout is used to ensure that our mouse position is actually updated (it comes after
						// keydown events)
						setTimeout(() => input.split(view));
					}
					break;
				}
				case 'Enter': {
					ui.chat.input.focus();
					break;
				}
			}

			const vision = world.views.get(view);
			if (!vision) return;

			// use e.isTrusted in case the key was bound to W
			if (e.isTrusted && !e.repeat) {
				if (e.key.toLowerCase() === sigmod.settings.doubleKey?.toLowerCase()) {
					setTimeout(() => input.split(view));
					// separate both splits by 50ms (at least one tick, 40ms) to ensure the correct piece goes in front
					// only when pushsplitting
					setTimeout(() => input.split(view), (vision.owned.size > 4 && settings.delayDouble) ? 50 : 0);
				} else if (e.key.toLowerCase() === sigmod.settings.tripleKey?.toLowerCase()) {
					// don't override any locks, and don't update 'until'
					inputs.lock ||= {
						type: 'point',
						mouse: inputs.mouse,
						world: input.toWorld(world.selected, inputs.mouse),
						until: performance.now() + 650,
					};
					setTimeout(() => input.split(view, 3));
				} else if (e.key.toLowerCase() === sigmod.settings.quadKey?.toLowerCase()) {
					setTimeout(() => input.split(view, 4));
				}
			}
			const camera = world.singleCamera(view, vision, 0, Infinity); // use latest data (.nx, .ny), uninterpolated

			if (e.isTrusted && e.key.toLowerCase() === sigmod.settings.horizontalLineKey?.toLowerCase()) {
				if (inputs.lock?.type === 'horizontal') {
					inputs.lock = undefined;
					ui.linesplit.update();
					return;
				}

				inputs.lock = {
					type: 'horizontal',
					world: [camera.sumX / camera.weight, camera.sumY / camera.weight],
					lastSplit: -Infinity,
				};
				ui.linesplit.update();
				return;
			}

			if (e.isTrusted && e.key.toLowerCase() === sigmod.settings.verticalLineKey?.toLowerCase()) {
				if (inputs.lock?.type === 'vertical') {
					inputs.lock = undefined;
					ui.linesplit.update();
					return;
				}

				inputs.lock = {
					type: 'vertical',
					world: [camera.sumX / camera.weight, camera.sumY / camera.weight],
					lastSplit: -Infinity,
				};
				ui.linesplit.update();
				return;
			}

			if (e.isTrusted && e.key.toLowerCase() === sigmod.settings.fixedLineKey?.toLowerCase()) {
				if (inputs.lock?.type === 'fixed') inputs.lock = undefined;
				else inputs.lock = { type: 'fixed' };
				ui.linesplit.update();
				return;
			}

			if (e.isTrusted && e.key.toLowerCase() === sigmod.settings.respawnKey?.toLowerCase()) {
				net.respawn(view, input.playData(input.name(view), false));
				return;
			}
		});

		addEventListener('keyup', e => {
			// allow inputs if unfocused
			if (e.code === 'KeyQ') net.qup(world.selected);
			else if (e.code === 'KeyW') {
				const inputs = input.views.get(world.selected) ?? create(world.selected);
				inputs.w = false; // don't change forceW
			}

			if (handleKeybind(e)) return;
		});

		addEventListener('mousedown', e => void (!unfocused() && handleKeybind(e)));
		addEventListener('mouseup', e => void (!unfocused() && handleKeybind(e)));
		addEventListener('beforeunload', e => e.preventDefault()); // prompt before closing window
		ui.game.canvas.addEventListener('contextmenu', e => e.preventDefault()); // prevent right clicking on the game
		// prevent dragging when some things are selected - i have a habit of unconsciously clicking all the time,
		// making me regularly drag text, disabling my mouse inputs for a bit
		addEventListener('dragstart', e => e.preventDefault());

		// #2 : play and spectate buttons, and captcha
		/**
		 * @param {string} name
		 * @param {boolean} spectating
		 */
		input.playData = (name, spectating) => {
			/** @type {HTMLInputElement | null} */
			const password = document.querySelector('input#password');

			return {
				state: spectating ? 2 : undefined,
				name,
				skin: aux.userData ? aux.settings.skin : '',
				token: aux.userData?.token,
				sub: (aux.userData?.subscription ?? 0) > Date.now(),
				clan: aux.userData?.clan,
				showClanmates: aux.settings.showClanmates,
				password: password?.value,
				email: aux.userData?.email,
			};
		};

		/** @type {HTMLInputElement[]} */
		input.nick = [aux.require(document.querySelector('input#nick'),
			'Can\'t find the nickname element. Try reloading the page?')];

		const nickList = () => {
			const target = settings.nbox ? settings.nboxCount : settings.multibox ? 2 : 1;
			for (let i = input.nick.length; i < target; ++i) {
				const el = /** @type {HTMLInputElement} */ (input.nick[0].cloneNode(true));
				Object.assign(el, { maxLength: 50, placeholder: `Nickname #${i + 1}`, value: settings.multiNames[i - 1] || '' });

				el.addEventListener('change', () => {
					settings.multiNames[i - 1] = el.value;
					settings.save();
				});

				const row = /** @type {Element} */ (input.nick[0].parentElement?.cloneNode());
				row.appendChild(el);
				input.nick[input.nick.length - 1].parentElement?.insertAdjacentElement('afterend', row);
				input.nick.push(el);
			}
			for (let i = input.nick.length; i > target; --i) input.nick.pop()?.parentElement?.remove();
		};
		nickList();
		setInterval(nickList, 500);

		/** @type {HTMLButtonElement} */
		const play = aux.require(document.querySelector('button#play-btn'),
			'Can\'t find the play button. Try reloading the page?');
		/** @type {HTMLButtonElement} */
		const spectate = aux.require(document.querySelector('button#spectate-btn'),
			'Can\'t find the spectate button. Try reloading the page?');

		const submitPlay = (spectate) => {
			const con = net.connections.get(world.selected);
			if (!con?.handshake) return;
			ui.toggleEscOverlay(false);
			net.play(world.selected, input.playData(input.name(world.selected), spectate));
		};
		play.addEventListener('click', () => submitPlay(false));
		spectate.addEventListener('click', () => submitPlay(true));

		play.disabled = spectate.disabled = true;
		setInterval(() => {
			play.disabled = spectate.disabled = !net.connections.get(world.selected)?.handshake;
		}, 100);

		return input;
	})();



	//////////////////////////
	// Configure WebGL Data //
	//////////////////////////
	const glconf = (() => {
		// note: WebGL functions only really return null if the context is lost - in which case, data will be replaced
		// anyway after it's restored. so, we cast everything to a non-null type.
		const glconf = {};
		const programs = glconf.programs = {};
		const uniforms = glconf.uniforms = {};
		/** @type {WebGLBuffer} */
		glconf.pelletAlphaBuffer = /** @type {never} */ (undefined);
		/** @type {WebGLBuffer} */
		glconf.pelletBuffer = /** @type {never} */ (undefined);
		glconf.vao = {};

		const gl = ui.game.gl;
		/** @type {Map<string, number>} */
		const uboBindings = new Map();

		const shader = (name, type, source) => {
			const s = /** @type {WebGLShader} */ (gl.createShader(type));
			gl.shaderSource(s, source);
			gl.compileShader(s);

			// note: compilation errors should not happen in production
			aux.require(
				gl.getShaderParameter(s, gl.COMPILE_STATUS) || gl.isContextLost(),
				`Can\'t compile WebGL2 shader "${name}". You might be on a weird browser.\n\nFull error log:\n` +
				gl.getShaderInfoLog(s),
			);

			return s;
		}

		const program = (name, vSource, fSource, ubos, textures) => {
			const vShader = shader(`${name}.vShader`, gl.VERTEX_SHADER, vSource.trim());
			const fShader = shader(`${name}.fShader`, gl.FRAGMENT_SHADER, fSource.trim());
			const p = /** @type {WebGLProgram} */ (gl.createProgram());

			gl.attachShader(p, vShader);
			gl.attachShader(p, fShader);
			gl.linkProgram(p);

			// note: linking errors should not happen in production
			aux.require(
				gl.getProgramParameter(p, gl.LINK_STATUS) || gl.isContextLost(),
				`Can\'t link WebGL2 program "${name}". You might be on a weird browser.\n\nFull error log:\n` +
				gl.getProgramInfoLog(p),
			);

			for (const tag of ubos) {
				const index = gl.getUniformBlockIndex(p, tag); // returns 4294967295 if invalid... just don't make typos
				let binding = uboBindings.get(tag);
				if (binding === undefined) uboBindings.set(tag, binding = uboBindings.size);
				gl.uniformBlockBinding(p, index, binding);

				const size = gl.getActiveUniformBlockParameter(p, index, gl.UNIFORM_BLOCK_DATA_SIZE);
				const ubo = uniforms[tag] = gl.createBuffer();
				gl.bindBuffer(gl.UNIFORM_BUFFER, ubo);
				gl.bufferData(gl.UNIFORM_BUFFER, size, gl.DYNAMIC_DRAW);
				gl.bindBufferBase(gl.UNIFORM_BUFFER, binding, ubo);
			}

			// bind texture uniforms to TEXTURE0, TEXTURE1, etc.
			gl.useProgram(p);
			for (let i = 0; i < textures.length; ++i) {
				const loc = gl.getUniformLocation(p, textures[i]);
				gl.uniform1i(loc, i);
			}
			gl.useProgram(null);

			return p;
		}

		const parts = {
			boilerplate: '#version 300 es\nprecision highp float; precision highp int;',
			borderUbo: `layout(std140) uniform Border { // size = 0x28
				vec4 u_border_color; // @ 0x00, i = 0
				vec4 u_border_xyzw_lrtb; // @ 0x10, i = 4
				int u_border_flags; // @ 0x20, i = 8
				float u_background_width; // @ 0x24, i = 9
				float u_background_height; // @ 0x28, i = 10
				float u_border_time; // @ 0x2c, i = 11
			};`,
			cameraUbo: `layout(std140) uniform Camera { // size = 0x10
				float u_camera_ratio; // @ 0x00
				float u_camera_scale; // @ 0x04
				vec2 u_camera_pos; // @ 0x08
			};`,
			cellUbo: `layout(std140) uniform Cell { // size = 0x28
				float u_cell_radius; // @ 0x00, i = 0
				float u_cell_radius_skin; // @ 0x04, i = 1
				vec2 u_cell_pos; // @ 0x08, i = 2
				vec4 u_cell_color; // @ 0x10, i = 4
				float u_cell_alpha; // @ 0x20, i = 8
				int u_cell_flags; // @ 0x24, i = 9
			};`,
			cellSettingsUbo: `layout(std140) uniform CellSettings { // size = 0x40
				vec4 u_cell_active_outline; // @ 0x00
				vec4 u_cell_inactive_outline; // @ 0x10
				vec4 u_cell_unsplittable_outline; // @ 0x20
				vec4 u_cell_subtle_outline_override; // @ 0x30
				float u_cell_active_outline_thickness; // @ 0x40
			};`,
			circleUbo: `layout(std140) uniform Circle { // size = 0x08
				float u_circle_alpha; // @ 0x00
				float u_circle_scale; // @ 0x04
			};`,
			textUbo: `layout(std140) uniform Text { // size = 0x38
				vec4 u_text_color1; // @ 0x00, i = 0
				vec4 u_text_color2; // @ 0x10, i = 4
				float u_text_alpha; // @ 0x20, i = 8
				float u_text_aspect_ratio; // @ 0x24, i = 9
				float u_text_scale; // @ 0x28, i = 10
				int u_text_silhouette_enabled; // @ 0x2c, i = 11
				vec2 u_text_offset; // @ 0x30, i = 12
			};`,
			tracerUbo: `layout(std140) uniform Tracer { // size = 0x10
				vec4 u_tracer_color; // @ 0x00, i = 0
				float u_tracer_thickness; // @ 0x10, i = 4
			};`,
		};

		glconf.init = () => {
			gl.enable(gl.BLEND);
			gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

			// create programs and uniforms
			programs.bg = program('bg', `
				${parts.boilerplate}
				layout(location = 0) in vec2 a_vertex;
				${parts.borderUbo}
				${parts.cameraUbo}
				flat out float f_blur;
				flat out float f_thickness;
				out vec2 v_uv;
				out vec2 v_world_pos;

				void main() {
					f_blur = 1.0 * (540.0 * u_camera_scale);
					f_thickness = max(3.0 / f_blur, 25.0); // force border to always be visible, otherwise it flickers

					v_world_pos = a_vertex * vec2(u_camera_ratio, 1.0) / u_camera_scale;
					v_world_pos += u_camera_pos * vec2(1.0, -1.0);

					if ((u_border_flags & 0x04) != 0) { // background repeating
						v_uv = v_world_pos * 0.02 * (50.0 / u_background_width);
						v_uv /= vec2(1.0, u_background_height / u_background_width);
					} else {
						v_uv = (v_world_pos - vec2(u_border_xyzw_lrtb.x, u_border_xyzw_lrtb.z))
							/ vec2(u_border_xyzw_lrtb.y - u_border_xyzw_lrtb.x,
								u_border_xyzw_lrtb.w - u_border_xyzw_lrtb.z);
						v_uv = vec2(v_uv.x, 1.0 - v_uv.y); // flip vertically
					}

					gl_Position = vec4(a_vertex, 0, 1); // span the whole screen
				}
			`, `
				${parts.boilerplate}
				flat in float f_blur;
				flat in float f_thickness;
				in vec2 v_uv;
				in vec2 v_world_pos;
				${parts.borderUbo}
				${parts.cameraUbo}
				uniform sampler2D u_texture;
				out vec4 out_color;

				void main() {
					if ((u_border_flags & 0x01) != 0) { // background enabled
						if ((u_border_flags & 0x04) != 0 // repeating
							|| (0.0 <= min(v_uv.x, v_uv.y) && max(v_uv.x, v_uv.y) <= 1.0)) { // within border
							out_color = texture(u_texture, v_uv);
						}
					}

					// make a larger inner rectangle and a normal inverted outer rectangle
					float inner_alpha = min(
						min((v_world_pos.x + f_thickness) - u_border_xyzw_lrtb.x,
							u_border_xyzw_lrtb.y - (v_world_pos.x - f_thickness)),
						min((v_world_pos.y + f_thickness) - u_border_xyzw_lrtb.z,
							u_border_xyzw_lrtb.w - (v_world_pos.y - f_thickness))
					);
					float outer_alpha = max(
						max(u_border_xyzw_lrtb.x - v_world_pos.x, v_world_pos.x - u_border_xyzw_lrtb.y),
						max(u_border_xyzw_lrtb.z - v_world_pos.y, v_world_pos.y - u_border_xyzw_lrtb.w)
					);
					float alpha = clamp(f_blur * min(inner_alpha, outer_alpha), 0.0, 1.0);
					if (u_border_color.a == 0.0) alpha = 0.0;

					vec4 border_color;
					if ((u_border_flags & 0x08) != 0) { // rainbow border
						float angle = atan(v_world_pos.y, v_world_pos.x) + u_border_time;
						float red = (2.0/3.0) * cos(6.0 * angle) + 1.0/3.0;
						float green = (2.0/3.0) * cos(6.0 * angle - 2.0 * 3.1415926535 / 3.0) + 1.0/3.0;
						float blue = (2.0/3.0) * cos(6.0 * angle - 4.0 * 3.1415926535 / 3.0) + 1.0/3.0;
						border_color = vec4(red, green, blue, 1.0);
					} else {
						border_color = u_border_color;
					}

					out_color = out_color * (1.0 - alpha) + border_color * alpha;
				}
			`, ['Border', 'Camera'], ['u_texture']);

			programs.cell = program('cell', `
				${parts.boilerplate}
				layout(location = 0) in vec2 a_vertex;
				${parts.cameraUbo}
				${parts.cellUbo}
				${parts.cellSettingsUbo}
				flat out vec4 f_active_outline;
				flat out float f_active_radius;
				flat out float f_blur;
				flat out int f_color_under_skin;
				flat out int f_show_skin;
				flat out vec4 f_subtle_outline;
				flat out float f_subtle_radius;
				flat out vec4 f_unsplittable_outline;
				flat out float f_unsplittable_radius;
				out vec2 v_vertex;
				out vec2 v_uv;

				void main() {
					f_blur = 0.5 * u_cell_radius * (540.0 * u_camera_scale);
					f_color_under_skin = u_cell_flags & 0x20;
					f_show_skin = u_cell_flags & 0x01;

					// subtle outlines (at least 1px wide)
					float subtle_thickness = max(max(u_cell_radius * 0.02, 2.0 / (540.0 * u_camera_scale)), 10.0);
					f_subtle_radius = 1.0 - (subtle_thickness / u_cell_radius);
					if ((u_cell_flags & 0x02) != 0) {
						f_subtle_outline = u_cell_color * 0.9; // darker outline by default
						f_subtle_outline.rgb += (u_cell_subtle_outline_override.rgb - f_subtle_outline.rgb)
							* u_cell_subtle_outline_override.a;
					} else {
						f_subtle_outline = vec4(0, 0, 0, 0);
					}

					// unsplittable cell outline, 2x the subtle thickness
					// (except at small sizes, it shouldn't look overly thick)
					float unsplittable_thickness = max(max(u_cell_radius * 0.04, 4.0 / (540.0 * u_camera_scale)), 10.0);
					f_unsplittable_radius = 1.0 - (unsplittable_thickness / u_cell_radius);
					if ((u_cell_flags & 0x10) != 0) {
						f_unsplittable_outline = u_cell_unsplittable_outline;
					} else {
						f_unsplittable_outline = vec4(0, 0, 0, 0);
					}

					// active multibox outlines (thick, a % of the visible cell radius)
					// or at minimum, 3x the subtle thickness
					float active_thickness = max(max(u_cell_radius * 0.06, 6.0 / (540.0 * u_camera_scale)), 10.0);
					f_active_radius = 1.0 - max(active_thickness / u_cell_radius, u_cell_active_outline_thickness);
					if ((u_cell_flags & 0x0c) != 0) {
						f_active_outline = (u_cell_flags & 0x04) != 0 ? u_cell_active_outline : u_cell_inactive_outline;
					} else {
						f_active_outline = vec4(0, 0, 0, 0);
					}

					v_vertex = a_vertex;
					v_uv = a_vertex * min(u_cell_radius / u_cell_radius_skin, 1.0) * 0.5 + 0.5;

					vec2 clip_pos = -u_camera_pos + u_cell_pos + v_vertex * u_cell_radius;
					clip_pos *= u_camera_scale * vec2(1.0 / u_camera_ratio, -1.0);
					gl_Position = vec4(clip_pos, 0, 1);
				}
			`, `
				${parts.boilerplate}
				flat in vec4 f_active_outline;
				flat in float f_active_radius;
				flat in float f_blur;
				flat in int f_color_under_skin;
				flat in int f_show_skin;
				flat in vec4 f_subtle_outline;
				flat in float f_subtle_radius;
				flat in vec4 f_unsplittable_outline;
				flat in float f_unsplittable_radius;
				in vec2 v_vertex;
				in vec2 v_uv;
				${parts.cameraUbo}
				${parts.cellUbo}
				${parts.cellSettingsUbo}
				uniform sampler2D u_skin;
				out vec4 out_color;

				void main() {
					float d = length(v_vertex.xy);
					if (f_show_skin == 0 || f_color_under_skin != 0) {
						out_color = u_cell_color;
					}

					// skin
					if (f_show_skin != 0) {
						vec4 tex = texture(u_skin, v_uv);
						out_color = out_color * (1.0 - tex.a) + tex;
					}

					// subtle outline
					float a = clamp(f_blur * (d - f_subtle_radius), 0.0, 1.0) * f_subtle_outline.a;
					out_color.rgb += (f_subtle_outline.rgb - out_color.rgb) * a;

					// active multibox outline
					a = clamp(f_blur * (d - f_active_radius), 0.0, 1.0) * f_active_outline.a;
					out_color.rgb += (f_active_outline.rgb - out_color.rgb) * a;

					// unsplittable cell outline
					a = clamp(f_blur * (d - f_unsplittable_radius), 0.0, 1.0) * f_unsplittable_outline.a;
					out_color.rgb += (f_unsplittable_outline.rgb - out_color.rgb) * a;

					// final circle mask
					a = clamp(-f_blur * (d - 1.0), 0.0, 1.0);
					out_color.a *= a * u_cell_alpha;
				}
			`, ['Camera', 'Cell', 'CellSettings'], ['u_skin']);

			// also used to draw glow
			programs.circle = program('circle', `
				${parts.boilerplate}
				layout(location = 0) in vec2 a_vertex;
				layout(location = 1) in vec2 a_cell_pos;
				layout(location = 2) in float a_cell_radius;
				layout(location = 3) in vec4 a_cell_color;
				layout(location = 4) in float a_cell_alpha;
				${parts.cameraUbo}
				${parts.circleUbo}
				out vec2 v_vertex;
				flat out float f_blur;
				flat out vec4 f_cell_color;

				void main() {
					float radius = a_cell_radius;
					f_cell_color = a_cell_color * vec4(1, 1, 1, a_cell_alpha * u_circle_alpha);
					if (u_circle_scale > 0.0) {
						f_blur = 1.0;
						radius *= u_circle_scale;
					} else {
						f_blur = 0.5 * a_cell_radius * (540.0 * u_camera_scale);
					}
					v_vertex = a_vertex;

					vec2 clip_pos = -u_camera_pos + a_cell_pos + v_vertex * radius;
					clip_pos *= u_camera_scale * vec2(1.0 / u_camera_ratio, -1.0);
					gl_Position = vec4(clip_pos, 0, 1);
				}
			`, `
				${parts.boilerplate}
				in vec2 v_vertex;
				flat in float f_blur;
				flat in vec4 f_cell_color;
				out vec4 out_color;

				void main() {
					// use squared distance for more natural glow; shouldn't matter for pellets
					float d = length(v_vertex.xy);
					out_color = f_cell_color;
					out_color.a *= clamp(f_blur * (1.0 - d), 0.0, 1.0);
				}
			`, ['Camera', 'Circle'], []);

			programs.text = program('text', `
				${parts.boilerplate}
				layout(location = 0) in vec2 a_vertex;
				${parts.cameraUbo}
				${parts.cellUbo}
				${parts.textUbo}
				out vec4 v_color;
				out vec2 v_uv;
				out vec2 v_vertex;

				void main() {
					v_uv = a_vertex * 0.5 + 0.5;
					float c2_alpha = (v_uv.x + v_uv.y) / 2.0;
					v_color = u_text_color1 * (1.0 - c2_alpha) + u_text_color2 * c2_alpha;
					v_vertex = a_vertex;

					vec2 clip_space = v_vertex * u_text_scale + u_text_offset;
					clip_space *= u_cell_radius_skin * 0.45 * vec2(u_text_aspect_ratio, 1.0);
					clip_space += -u_camera_pos + u_cell_pos;
					clip_space *= u_camera_scale * vec2(1.0 / u_camera_ratio, -1.0);
					gl_Position = vec4(clip_space, 0, 1);
				}
			`, `
				${parts.boilerplate}
				in vec4 v_color;
				in vec2 v_uv;
				in vec2 v_vertex;
				${parts.cameraUbo}
				${parts.cellUbo}
				${parts.textUbo}
				uniform sampler2D u_texture;
				uniform sampler2D u_silhouette;
				out vec4 out_color;

				float f(float x) {
					// a cubic function with turning points at (0,0) and (1,0)
					// meant to sharpen out blurry linear interpolation
					return x * x * (3.0 - 2.0*x);
				}

				vec4 fv(vec4 v) {
					return vec4(f(v.x), f(v.y), f(v.z), f(v.w));
				}

				void main() {
					vec4 normal = texture(u_texture, v_uv);

					if (u_text_silhouette_enabled != 0) {
						vec4 silhouette = texture(u_silhouette, v_uv);

						// #fff - #000 => color (text)
						// #fff - #fff => #fff (respect emoji)
						// #888 - #888 => #888 (respect emoji)
						// #fff - #888 => #888 + color/2 (blur/antialias)
						out_color = silhouette + fv(normal - silhouette) * v_color;
					} else {
						out_color = fv(normal) * v_color;
					}

					out_color.a *= u_text_alpha;
				}
			`, ['Camera', 'Cell', 'Text'], ['u_texture', 'u_silhouette']);

			programs.tracer = program('tracer', `
				${parts.boilerplate}
				layout(location = 0) in vec2 a_vertex;
				layout(location = 1) in vec2 a_pos1;
				layout(location = 2) in vec2 a_pos2;
				${parts.cameraUbo}
				${parts.tracerUbo}
				out vec2 v_vertex;

				void main() {
					v_vertex = a_vertex;
					float alpha = (a_vertex.x + 1.0) / 2.0;
					float d = length(a_pos2 - a_pos1);
					float thickness = 0.001 / u_camera_scale * u_tracer_thickness;
					// black magic
					vec2 world_pos = a_pos1 + (a_pos2 - a_pos1)
						* mat2(alpha, a_vertex.y / d * thickness, a_vertex.y / d * -thickness, alpha);

					vec2 clip_pos = -u_camera_pos + world_pos;
					clip_pos *= u_camera_scale * vec2(1.0 / u_camera_ratio, -1.0);
					gl_Position = vec4(clip_pos, 0, 1);
				}
			`, `
				${parts.boilerplate}
				in vec2 v_pos;
				${parts.tracerUbo}
				out vec4 out_color;

				void main() {
					out_color = u_tracer_color;
				}
			`, ['Camera', 'Tracer'], []);

			// initialize two VAOs; one for pellets and all other objects (0), one for cell glow only (1)
			glconf.vao = {};
			const squareVAA = () => {
				// square (location = 0), used for all instances
				gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
				gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([ -1, -1,   1, -1,   -1, 1,   1, 1 ]), gl.STATIC_DRAW);
				gl.enableVertexAttribArray(0);
				gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
			};
			const circleVAA = () => {
				// circle buffer (each instance is 6 floats or 24 bytes)
				const circleBuffer = /** @type {WebGLBuffer} */ (gl.createBuffer());
				gl.bindBuffer(gl.ARRAY_BUFFER, circleBuffer);
				// a_cell_pos, vec2 (location = 1)
				gl.enableVertexAttribArray(1);
				gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 4 * 7, 0);
				gl.vertexAttribDivisor(1, 1);
				// a_cell_radius, float (location = 2)
				gl.enableVertexAttribArray(2);
				gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 4 * 7, 4 * 2);
				gl.vertexAttribDivisor(2, 1);
				// a_cell_color, vec3 (location = 3)
				gl.enableVertexAttribArray(3);
				gl.vertexAttribPointer(3, 4, gl.FLOAT, false, 4 * 7, 4 * 3);
				gl.vertexAttribDivisor(3, 1);

				return circleBuffer;
			};
			const alphaVAA = () => {
				// circle alpha buffer, updated every frame
				const alphaBuffer = /** @type {WebGLBuffer} */ (gl.createBuffer());
				gl.bindBuffer(gl.ARRAY_BUFFER, alphaBuffer);
				// a_cell_alpha, float (location = 4)
				gl.enableVertexAttribArray(4);
				gl.vertexAttribPointer(4, 1, gl.FLOAT, false, 0, 0);
				gl.vertexAttribDivisor(4, 1);

				return alphaBuffer;
			};
			const lineVAA = () => {
				// circle alpha buffer, updated every frame
				const lineBuffer = /** @type {WebGLBuffer} */ (gl.createBuffer());
				gl.bindBuffer(gl.ARRAY_BUFFER, lineBuffer);
				// a_pos1, vec2 (location = 1)
				gl.enableVertexAttribArray(1);
				gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 4 * 4, 0);
				gl.vertexAttribDivisor(1, 1);
				// a_pos2, vec2 (location = 2)
				gl.enableVertexAttribArray(2);
				gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 4 * 4, 4 * 2);
				gl.vertexAttribDivisor(2, 1);

				return lineBuffer;
			};

			// main vao
			let vao = /** @type {WebGLVertexArrayObject} */ (gl.createVertexArray());
			gl.bindVertexArray(vao);
			squareVAA();
			glconf.vao.main = { vao };

			// cell glow vao
			vao = /** @type {WebGLVertexArrayObject} */ (gl.createVertexArray());
			gl.bindVertexArray(vao);
			squareVAA();
			glconf.vao.cell = { vao, circle: circleVAA(), alpha: alphaVAA() };
			
			// pellet + pellet glow vao
			vao = /** @type {WebGLVertexArrayObject} */ (gl.createVertexArray());
			gl.bindVertexArray(vao);
			squareVAA();
			glconf.vao.pellet = { vao, circle: circleVAA(), alpha: alphaVAA() };

			// tracer vao
			vao = /** @type {WebGLVertexArrayObject} */ (gl.createVertexArray());
			gl.bindVertexArray(vao);
			squareVAA();
			glconf.vao.tracer = { vao, line: lineVAA() };
		};

		glconf.init();
		return glconf;
	})();



	///////////////////////////////
	// Define Rendering Routines //
	///////////////////////////////
	const render = (() => {
		const render = {};
		const { gl } = ui.game;

		// #1 : define small misc objects
		// no point in breaking this across multiple lines
		// eslint-disable-next-line max-len
		const darkGridSrc = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADIAAAAyCAYAAAAeP4ixAAAACXBIWXMAAA7DAAAOwwHHb6hkAAAAGXRFWHRTb2Z0d2FyZQB3d3cuaW5rc2NhcGUub3Jnm+48GgAAAGBJREFUaIHtz4EJwCAAwDA39oT/H+qeEAzSXNA+a61xgfmeLtilEU0jmkY0jWga0TSiaUTTiKYRTSOaRjSNaBrRNKJpRNOIphFNI5pGNI1oGtE0omlEc83IN8aYpyN2+AH6nwOVa0odrQAAAABJRU5ErkJggg==';
		// eslint-disable-next-line max-len
		const lightGridSrc = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADIAAAAyCAYAAAAeP4ixAAAACXBIWXMAAA7DAAAOwwHHb6hkAAAAGXRFWHRTb2Z0d2FyZQB3d3cuaW5rc2NhcGUub3Jnm+48GgAAAGFJREFUaIHtzwENgDAQwMA9LvAvdJgg2UF6CtrZe6+vm5n7Oh3xlkY0jWga0TSiaUTTiKYRTSOaRjSNaBrRNKJpRNOIphFNI5pGNI1oGtE0omlE04imEc1vRmatdZ+OeMMDa8cDlf3ZAHkAAAAASUVORK5CYII=';

		let lastMinimapDraw = performance.now();
		/** @type {{ bg: ImageData, darkTheme: boolean } | undefined} */
		let minimapCache;
		document.fonts.addEventListener('loadingdone', () => void (minimapCache = undefined));


		// #2 : define caching functions
		const { resetDatabaseCache, resetTextureCache, textureFromCache, textureFromDatabase } = (() => {
			/** @type {Map<string, {
			 * 	color: [number, number, number, number], texture: WebGLTexture, width: number, height: number
			 * } | null>} */
			const cache = new Map();
			render.textureCache = cache;

			/** @type {Map<string, {
			 * 	color: [number, number, number, number], texture: WebGLTexture, width: number, height: number
			 * } | null>} */
			const dbCache = new Map();
			render.dbCache = dbCache;

			return {
				resetTextureCache: () => cache.clear(),
				/**
				 * @param {string} src
				 * @returns {{
				 * 	color: [number, number, number, number], texture: WebGLTexture, width: number, height: number
				 * } | undefined}
				 */
				textureFromCache: src => {
					const cached = cache.get(src);
					if (cached !== undefined)
						return cached ?? undefined;

					cache.set(src, null);

					const image = new Image();
					image.crossOrigin = '';
					image.addEventListener('load', () => {
						const texture = /** @type {WebGLTexture} */ (gl.createTexture());
						if (!texture) return;

						gl.bindTexture(gl.TEXTURE_2D, texture);
						gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
						gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_NEAREST);
						gl.generateMipmap(gl.TEXTURE_2D);

						const color = aux.dominantColor(image);
						cache.set(src, { color, texture, width: image.width, height: image.height });
					});
					image.src = src;

					return undefined;
				},
				resetDatabaseCache: () => dbCache.clear(),
				/**
				 * @param {string} key
				 * @returns {{
				 * 	color: [number, number, number, number], texture: WebGLTexture, width: number, height: number
				 * } | undefined}
				 */
				textureFromDatabase: key => {
					const cached = dbCache.get(key);
					if (cached !== undefined)
						return cached ?? undefined;

					/** @type {IDBDatabase | undefined} */
					const database = settings.database;
					if (!database) return undefined;

					dbCache.set(key, null);
					const req = database.transaction('images').objectStore('images').get(key);
					req.addEventListener('success', () => {
						if (!req.result) return;

						const reader = new FileReader();
						reader.addEventListener('load', () => {
							const image = new Image();
							// this can cause a lot of lag (~500ms) when loading a large image for the first time
							image.addEventListener('load', () => {
								const texture = gl.createTexture();
								if (!texture) return;

								gl.bindTexture(gl.TEXTURE_2D, texture);
								gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
								gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_NEAREST);
								gl.generateMipmap(gl.TEXTURE_2D);

								const color = aux.dominantColor(image);
								dbCache.set(key, { color, texture, width: image.width, height: image.height });
							});
							image.src = /** @type {string} */ (reader.result);
						});
						reader.readAsDataURL(req.result);
					});
					req.addEventListener('error', err => {
						console.warn(`sigfix database failed to get ${key}:`, err);
					});
				},
			};
		})();
		render.resetDatabaseCache = resetDatabaseCache;
		render.resetTextureCache = resetTextureCache;

		const { maxMassWidth, refreshTextCache, massTextFromCache, resetTextCache, textFromCache } = (() => {
			/**
			 * @template {boolean} T
			 * @typedef {{
			 * 	aspectRatio: number,
			 * 	text: WebGLTexture | null,
			 *	silhouette: WebGLTexture | null | undefined,
			 * 	accessed: number
			 * }} CacheEntry
			 */
			/** @type {Map<string, CacheEntry<boolean>>} */
			const cache = new Map();
			render.textCache = cache;

			setInterval(() => {
				// remove text after not being used for 1 minute
				const now = performance.now();
				cache.forEach((entry, text) => {
					if (now - entry.accessed > 60_000) {
						// immediately delete text instead of waiting for GC
						if (entry.text !== undefined)
							gl.deleteTexture(entry.text);
						if (entry.silhouette !== undefined)
							gl.deleteTexture(entry.silhouette);
						cache.delete(text);
					}
				});
			}, 60_000);

			const canvas = document.createElement('canvas');
			const ctx = aux.require(
				canvas.getContext('2d', { willReadFrequently: true }),
				'Unable to get 2D context for text drawing. This is probably your browser being weird, maybe reload ' +
				'the page?',
			);

			// sigmod forces a *really* ugly shadow on ctx.fillText so we have to lock the property beforehand
			const realProps = Object.getOwnPropertyDescriptors(Object.getPrototypeOf(ctx));
			const realShadowBlurSet = realProps.shadowBlur.set.bind(ctx);
			const realShadowColorSet = realProps.shadowColor.set.bind(ctx);
			Object.defineProperties(ctx, {
				shadowBlur: {
					get: () => 0,
					set: x => {
						if (x === 0) realShadowBlurSet(0);
						else realShadowBlurSet(8);
					},
				},
				shadowColor: {
					get: () => 'transparent',
					set: x => {
						if (x === 'transparent') realShadowColorSet('transparent');
						else realShadowColorSet('#0003');
					},
				},
			});

			/**
			 * @param {string} text
			 * @param {boolean} silhouette
			 * @param {boolean} mass
			 * @returns {WebGLTexture | null}
			 */
			const texture = (text, silhouette, mass) => {
				const texture = gl.createTexture();
				if (!texture) return texture;

				const baseTextSize = 96; // TODO: Too high quality?
				const textSize = baseTextSize * (mass ? 0.5 * settings.massScaleFactor : settings.nameScaleFactor);
				const lineWidth = Math.ceil(textSize / 10) * settings.textOutlinesFactor;

				let font = `${textSize}px "${sigmod.settings.font || 'Ubuntu'}", Ubuntu`;
				if (mass ? settings.massBold : settings.nameBold) font = 'bold ' + font;
				ctx.font = font;
				// if rendering an empty string (somehow) then width can be 0 with no outlines
				canvas.width = (ctx.measureText(text).width + lineWidth * 4) || 1;
				canvas.height = textSize * 3;
				ctx.clearRect(0, 0, canvas.width, canvas.height); // TODO: necessary?

				// setting canvas.width resets the canvas state
				ctx.font = font;
				ctx.lineJoin = 'round';
				ctx.lineWidth = lineWidth;
				ctx.fillStyle = silhouette ? '#000' : '#fff';
				ctx.strokeStyle = '#000';
				ctx.textBaseline = 'middle';

				ctx.shadowBlur = lineWidth;
				ctx.shadowColor = lineWidth > 0 ? '#0002' : 'transparent';

				// add a space, which is to prevent sigmod from detecting the name
				if (lineWidth > 0) ctx.strokeText(text + ' ', lineWidth * 2, textSize * 1.5);
				ctx.shadowColor = 'transparent';
				ctx.fillText(text + ' ', lineWidth * 2, textSize * 1.5);

				const data = ctx.getImageData(0, 0, canvas.width, canvas.height);

				gl.bindTexture(gl.TEXTURE_2D, texture);
				gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, data);
				gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
				gl.generateMipmap(gl.TEXTURE_2D);
				return texture;
			};

			let maxMassWidth = 0;
			/** @type {({ height: number, width: number, texture: WebGLTexture | null } | undefined)[]} */
			const massTextCache = [];

			/**
			 * @param {string} digit
			 * @returns {{ height: number, width: number, texture: WebGLTexture | null }}
			 */
			const massTextFromCache = digit => {
				let cached = massTextCache[/** @type {any} */ (digit)];
				if (!cached) {
					cached = massTextCache[digit] = {
						texture: texture(digit, false, true),
						height: canvas.height, // mind the execution order
						width: canvas.width,
					};
					if (cached.width > maxMassWidth) maxMassWidth = cached.width;
				}

				return cached;
			};

			const resetTextCache = () => {
				cache.clear();
				maxMassWidth = 0;
				massTextCache.length = 0;
			};

			/** @type {{
			 * 	massBold: boolean, massScaleFactor: number, nameBold: boolean, nameScaleFactor: number,
			 * 	outlinesFactor: number, font: string | undefined,
			 * } | undefined} */
			let drawn;

			const refreshTextCache = () => {
				if (!drawn ||
					(drawn.massBold !== settings.massBold || drawn.massScaleFactor !== settings.massScaleFactor
						|| drawn.nameBold !== settings.nameBold || drawn.nameScaleFactor !== settings.nameScaleFactor
						|| drawn.outlinesFactor !== settings.textOutlinesFactor || drawn.font !== sigmod.settings.font)
				) {
					resetTextCache();
					drawn = {
						massBold: settings.massBold, massScaleFactor: settings.massScaleFactor,
						nameBold: settings.nameBold, nameScaleFactor: settings.nameScaleFactor,
						outlinesFactor: settings.textOutlinesFactor, font: sigmod.settings.font,
					};
				}
			};

			/**
			 * @template {boolean} T
			 * @param {string} text
			 * @param {T} silhouette
			 * @returns {CacheEntry<T>}
			 */
			const textFromCache = (text, silhouette) => {
				let entry = cache.get(text);
				if (!entry) {
					const shortened = aux.trim(text);
					cache.set(text, entry = {
						text: texture(shortened, false, false),
						aspectRatio: canvas.width / canvas.height, // mind the execution order
						silhouette: silhouette ? texture(shortened, true, false) : undefined,
						accessed: performance.now(),
					});
				} else {
					entry.accessed = performance.now();
				}

				if (silhouette && entry.silhouette === undefined)
					setTimeout(() => entry.silhouette = texture(aux.trim(text), true, false));
				return entry;
			};

			// reload text once Ubuntu has loaded, prevents some serif fonts from being locked in
			// also support loading in new fonts at any time via sigmod
			document.fonts.addEventListener('loadingdone', () => resetTextCache());

			return {
				maxMassWidth: () => maxMassWidth,
				massTextFromCache,
				refreshTextCache,
				resetTextCache,
				textFromCache,
			};
		})();
		render.resetTextCache = resetTextCache;
		render.textFromCache = textFromCache;

		// #3 : define other render functions
		render.alpha = (frame, now) => {
			let alpha = (now - frame.born) / settings.drawDelay;
			if (frame.deadAt !== undefined) alpha = Math.min(alpha, 1 - (now - frame.deadAt) / settings.drawDelay);
			return Math.min(Math.max(alpha, 0), 1);
		};

		/**
		 * @param {Cell} cell
		 */
		render.skin = cell => {
			const desc = world.synchronized ? cell.views.values().next().value : cell.views.get(world.selected);
			if (!desc) return undefined;

			let ownerView;
			for (const [view, vision] of world.views) {
				if (vision.owned.has(cell.id)) {
					ownerView = view;
					break;
				}
			}

			// 🖼️
			let texture;
			if (ownerView) {
				const index = world.multis.indexOf(ownerView);
				if (index >= 2) {
					if (settings.selfSkinNbox[index]) {
						if (settings.selfSkinNbox[index].startsWith('🖼️')) texture = textureFromDatabase(`selfSkinNbox.${index}`);
						else texture = textureFromCache(settings.selfSkinNbox[index]);
					}
				} else {
					const prop = ownerView === world.viewId.secondary ? 'selfSkinMulti' : 'selfSkin';
					if (settings[prop]) {
						if (settings[prop].startsWith('🖼️')) texture = textureFromDatabase(prop);
						else texture = textureFromCache(settings[prop]);
					}
				}
			}

			// allow turning off sigmally skins while still using custom skins
			if (!texture && aux.settings.showSkins && desc.skin) texture = textureFromCache(desc.skin);
			return texture;
		};

		const circleBuffers = {
			cell: new Float32Array(0),
			cellAlpha: new Float32Array(0),
			/** @type {object | undefined} */
			lastCellVao: undefined,
			pellet: new Float32Array(0),
			pelletAlpha: new Float32Array(0),
			pelletsUploaded: 0,
			/** @type {object | undefined} */
			lastPelletVao: undefined,
		};
		/** @param {boolean} pellets */
		render.upload = pellets => {
			const now = performance.now();
			if (now - render.lastFrame > 1000) {
				// do not render pellets on inactive windows (very laggy!)
				circleBuffers.pelletsUploaded = 0;
				return;
			}

			let uploading = 0;
			for (const cell of world[pellets ? 'pellets' : 'cells'].values()) {
				const frame = world.synchronized ? cell.merged : cell.views.get(world.selected)?.frames[0];
				if (!frame) continue;
				if (pellets) {
					if (frame.deadTo === -1) ++uploading;
				} else {
					/** @type {CellDescription} */
					const desc = world.synchronized ? cell.views.values().next().value : cell.views.get(world.selected);
					if (!desc) continue; // shouldn't happen
					if (!desc.jagged) ++uploading; // don't make viruses glow
				}
			}

			let alpha = circleBuffers[pellets ? 'pelletAlpha' : 'cellAlpha'];
			let instances = circleBuffers[pellets ? 'pellet' : 'cell'];
			const vao = glconf.vao[pellets ? 'pellet' : 'cell'];

			// resize buffers as necessary
			let capacity = alpha.length || 1;
			let resizing = circleBuffers[pellets ? 'lastPelletVao' : 'lastCellVao'] !== vao;
			while (capacity < uploading) {
				capacity *= 2;
				resizing = true;
			}
			if (resizing) {
				alpha = circleBuffers[pellets ? 'pelletAlpha' : 'cellAlpha'] = new Float32Array(capacity);
				instances = circleBuffers[pellets ? 'pellet' : 'cell'] = new Float32Array(capacity * 7);
			}

			const override = pellets ? sigmod.settings.foodColor : sigmod.settings.cellColor;
			let i = 0;
			for (const cell of world[pellets ? 'pellets' : 'cells'].values()) {
				const frame = world.synchronized ? cell.merged : cell.views.get(world.selected)?.frames[0];
				if (!frame || (pellets && frame.deadTo !== -1)) continue;

				let x, y, r;
				if (pellets) {
					({ nx: x, ny: y, nr: r } = frame);
				} else {
					const interp = world.synchronized ? cell.merged : cell.views.get(world.selected);
					if (!interp) continue; // should never happen (ts-check)

					/** @type {CellFrame | undefined} */
					let killerFrame;
					/** @type {CellInterpolation | undefined} */
					let killerInterp;
					let killer = frame.deadTo !== -1 && world.cells.get(frame.deadTo);
					if (killer) {
						killerFrame = world.synchronized ? killer.merged : killer.views.get(world.selected)?.frames[0];
						killerInterp = world.synchronized ? killer.merged : killer.views.get(world.selected);
					}

					({ x, y, r } = world.xyr(frame, interp, killerFrame, killerInterp, false, now));
				}
				instances[i * 7] = x;
				instances[i * 7 + 1] = y;
				instances[i * 7 + 2] = r;

				/** @type {CellDescription} */
				const desc = world.synchronized ? cell.views.values().next().value : cell.views.get(world.selected);
				if (!desc || desc.jagged) continue;

				/** @type {[number, number, number] | [number, number, number, number]} */
				let color = desc.rgb;
				if (pellets) {
					if (override?.[0] === 0 && override?.[1] === 0 && override?.[2] === 0) {
						color = [color[0], color[1], color[2], override[3]];
					} else if (override) {
						color = override;
					}
				} else {
					if (override) color = override;
					const skin = render.skin(cell);
					if (skin) {
						// blend with player color
						if (settings.colorUnderSkin) {
							color = [
								color[0] + (skin.color[0] - color[0]) * skin.color[3],
								color[1] + (skin.color[1] - color[1]) * skin.color[3],
								color[2] + (skin.color[2] - color[2]) * skin.color[3],
								1
							];
						} else {
							color = [skin.color[0], skin.color[1], skin.color[2], 1];
						}
					}
				}
				instances[i * 7 + 3] = color[0];
				instances[i * 7 + 4] = color[1];
				instances[i * 7 + 5] = color[2];
				instances[i * 7 + 6] = color[3] ?? 1;

				++i;
			}

			// now, upload data
			if (resizing) {
				gl.bindBuffer(gl.ARRAY_BUFFER, vao.alpha);
				gl.bufferData(gl.ARRAY_BUFFER, alpha.byteLength, gl.STATIC_DRAW);
				gl.bindBuffer(gl.ARRAY_BUFFER, vao.circle);
				gl.bufferData(gl.ARRAY_BUFFER, instances, gl.STATIC_DRAW);
			} else {
				gl.bindBuffer(gl.ARRAY_BUFFER, vao.circle);
				gl.bufferSubData(gl.ARRAY_BUFFER, 0, instances);
			}
			gl.bindBuffer(gl.ARRAY_BUFFER, null);

			if (pellets) circleBuffers.pelletsUploaded = uploading;
			circleBuffers[pellets ? 'lastPelletVao' : 'lastCellVao'] = vao;
		};

		let tracerFloats = new Float32Array(0);

		// #4 : define ubo views
		// firefox (and certain devices) adds some padding to uniform buffer sizes, so best to check its size
		gl.bindBuffer(gl.UNIFORM_BUFFER, glconf.uniforms.Border);
		const borderUboBuffer = new ArrayBuffer(gl.getBufferParameter(gl.UNIFORM_BUFFER, gl.BUFFER_SIZE));
		// must reference an arraybuffer for the memory to be shared between these views
		const borderUboFloats = new Float32Array(borderUboBuffer);
		const borderUboInts = new Int32Array(borderUboBuffer);

		gl.bindBuffer(gl.UNIFORM_BUFFER, glconf.uniforms.Cell);
		const cellUboBuffer = new ArrayBuffer(gl.getBufferParameter(gl.UNIFORM_BUFFER, gl.BUFFER_SIZE));
		const cellUboFloats = new Float32Array(cellUboBuffer);
		const cellUboInts = new Int32Array(cellUboBuffer);

		gl.bindBuffer(gl.UNIFORM_BUFFER, glconf.uniforms.Circle);
		const circleUboFloats = new Float32Array(gl.getBufferParameter(gl.UNIFORM_BUFFER, gl.BUFFER_SIZE) / 4);

		gl.bindBuffer(gl.UNIFORM_BUFFER, glconf.uniforms.Text);
		const textUboBuffer = new ArrayBuffer(gl.getBufferParameter(gl.UNIFORM_BUFFER, gl.BUFFER_SIZE));
		const textUboFloats = new Float32Array(textUboBuffer);
		const textUboInts = new Int32Array(textUboBuffer);

		gl.bindBuffer(gl.UNIFORM_BUFFER, glconf.uniforms.Tracer);
		const tracerUboFloats = new Float32Array(gl.getBufferParameter(gl.UNIFORM_BUFFER, gl.BUFFER_SIZE) / 4);

		gl.bindBuffer(gl.UNIFORM_BUFFER, null); // leaving uniform buffer bound = scary!


		// #5 : define the render function
		render.fps = 0;
		render.lastFrame = performance.now();
		const renderGame = () => {
			const now = performance.now();
			const dt = Math.max(now - render.lastFrame, 0.1) / 1000; // there's a chance (now - lastFrame) can be 0
			render.fps += (1 / dt - render.fps) / 10;
			render.lastFrame = now;

			if (gl.isContextLost()) return requestAnimationFrame(renderGame);

			// get settings
			const defaultVirusSrc = '/assets/images/viruses/2.png';
			const virusSrc = sigmod.settings.virusImage || defaultVirusSrc;
			const { cellColor, foodColor, outlineColor, showNames } = sigmod.settings;

			refreshTextCache();

			const vision = aux.require(world.views.get(world.selected), 'no selected vision (BAD BUG)');
			vision.used = performance.now();
			world.cameras(now);

			// note: most routines are named, for benchmarking purposes
			(function setGlobalUniforms() {
				// note that binding the same buffer to gl.UNIFORM_BUFFER twice in a row causes it to not update.
				// why that happens is completely beyond me but oh well.
				// for consistency, we always bind gl.UNIFORM_BUFFER to null directly after updating it.
				gl.bindBuffer(gl.UNIFORM_BUFFER, glconf.uniforms.Camera);
				gl.bufferSubData(gl.UNIFORM_BUFFER, 0, new Float32Array([
					ui.game.canvas.width / ui.game.canvas.height, vision.camera.scale / 540,
					vision.camera.x, vision.camera.y,
				]));
				gl.bindBuffer(gl.UNIFORM_BUFFER, null);

				gl.bindBuffer(gl.UNIFORM_BUFFER, glconf.uniforms.CellSettings);
				gl.bufferSubData(gl.UNIFORM_BUFFER, 0, new Float32Array([
					...settings.outlineMultiColor, // cell_active_outline
					...settings.outlineMultiInactiveColor, // cell_inactive_outline
					...settings.unsplittableColor, // cell_unsplittable_outline
					...(outlineColor ?? [0, 0, 0, 0]), // cell_subtle_outline_override
					settings.outlineMulti,
				]));
				gl.bindBuffer(gl.UNIFORM_BUFFER, null);
			})();

			(function background() {
				if (sigmod.settings.mapColor) gl.clearColor(...sigmod.settings.mapColor);
				else if (aux.settings.darkTheme) gl.clearColor(0x11 / 255, 0x11 / 255, 0x11 / 255, 1); // #111
				else gl.clearColor(0xf2 / 255, 0xfb / 255, 0xff / 255, 1); // #f2fbff
				gl.clear(gl.COLOR_BUFFER_BIT);

				gl.useProgram(glconf.programs.bg);
				gl.bindVertexArray(glconf.vao.main.vao);

				let texture;
				if (settings.background) {
					if (settings.background.startsWith('🖼️')) texture = textureFromDatabase('background');
					else texture = textureFromCache(settings.background);
				} else if (aux.settings.showGrid) {
					texture = textureFromCache(aux.settings.darkTheme ? darkGridSrc : lightGridSrc);
				}
				gl.bindTexture(gl.TEXTURE_2D, texture?.texture ?? null);
				const repeating = texture && texture.width <= 512 && texture.height <= 512;

				let borderColor;
				let borderLrtb;
				borderColor = (aux.settings.showBorder && vision.border) ? [0, 0, 1, 1] /* #00ff */
					: [0, 0, 0, 0] /* transparent */;
				borderLrtb = vision.border || { l: 0, r: 0, t: 0, b: 0 };

				borderUboFloats.set(borderColor, 0); // u_border_color
				borderUboFloats.set([borderLrtb.l, borderLrtb.r, borderLrtb.t, borderLrtb.b], 4); // u_border_xyzw_lrtb
				// flags
				borderUboInts[8] = (texture ? 0x01 : 0) | (aux.settings.darkTheme ? 0x02 : 0) | (repeating ? 0x04 : 0)
					| (settings.rainbowBorder ? 0x08 : 0);

				borderUboFloats[9] = texture?.width ?? 1; // u_background_width
				borderUboFloats[10] = texture?.height ?? 1; // u_background_height
				borderUboFloats[11] = now / 1000 * 0.2 % (Math.PI * 2); // u_border_time

				gl.bindBuffer(gl.UNIFORM_BUFFER, glconf.uniforms.Border);
				gl.bufferSubData(gl.UNIFORM_BUFFER, 0, borderUboFloats);
				gl.bindBuffer(gl.UNIFORM_BUFFER, null);
				gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
			})();

			(function cells() {
				// don't render anything if the current tab is not connected
				const con = net.connections.get(world.selected);
				if (!con?.handshake) return;

				// for white cell outlines
				let nextCellIdx = 0;
				const ownedArray = Array.from(vision.owned);
				/** @type {(CellFrame | undefined)[]} */
				const ownedToFrame = ownedArray.map(id => {
					const cell = world.cells.get(id);
					return world.synchronized ? cell?.merged : cell?.views.get(world.selected)?.frames[0];
				});
				for (const cell of ownedToFrame) {
					if (cell && cell.deadAt === undefined) ++nextCellIdx;
				}
				const canSplit = ownedToFrame.map(cell => {
					if (!cell || cell.nr < 128) return false;
					return nextCellIdx++ < 16;
				});

				/**
				 * @param {Cell} cell
				 * @param {boolean} pellet
				 */
				const draw = (cell, pellet) => {
					// #1 : draw cell
					/** @type {CellFrame | undefined} */
					const frame = world.synchronized ? cell.merged : cell.views.get(world.selected)?.frames[0];
					/** @type {CellInterpolation | undefined} */
					const interp = world.synchronized ? cell.merged : cell.views.get(world.selected);
					if (!frame || !interp) return;

					/** @type {CellDescription | undefined} */
					const desc = world.synchronized ? cell.views.values().next().value : cell.views.get(world.selected);
					if (!desc) return;

					/** @type {CellFrame | undefined} */
					let killerFrame;
					/** @type {CellInterpolation | undefined} */
					let killerInterp;
					let killer = frame.deadTo !== -1 && world.cells.get(frame.deadTo);
					if (killer) {
						killerFrame = world.synchronized ? killer.merged : killer.views.get(world.selected)?.frames[0];
						killerInterp = world.synchronized ? killer.merged : killer.views.get(world.selected);
					}

					gl.useProgram(glconf.programs.cell);

					const alpha = render.alpha(frame, now);
					cellUboFloats[8] = alpha * settings.cellOpacity;

					const { x, y, r, jr } = world.xyr(frame, interp, killerFrame, killerInterp, pellet, now);
					// without jelly physics, the radius of cells is adjusted such that its subtle outline doesn't go
					// past its original radius.
					// jelly physics does not do this, so colliding cells need to look kinda 'joined' together,
					// so we multiply the radius by 1.02 (approximately the size increase from the stroke thickness)
					cellUboFloats[2] = x;
					cellUboFloats[3] = y;
					if (aux.settings.jellyPhysics && !desc.jagged && !pellet) {
						const strokeThickness = Math.max(jr * 0.01, 10);
						cellUboFloats[0] = jr + strokeThickness;
						cellUboFloats[1] = (settings.jellySkinLag ? r : jr) + strokeThickness;
					} else {
						cellUboFloats[0] = cellUboFloats[1] = r + 2;
					}

					if (desc.jagged) {
						const virusTexture = textureFromCache(virusSrc);
						if (virusTexture) {
							gl.bindTexture(gl.TEXTURE_2D, virusTexture.texture);
							cellUboInts[9] = 0x01; // skin and nothing else
							// draw a fully transparent cell
							cellUboFloats[4] = cellUboFloats[5] = cellUboFloats[6] = cellUboFloats[7] = 0;
						} else {
							cellUboInts[9] = 0;
							// #ff000080 if the virus texture doesn't load
							cellUboFloats.set([1, 0, 0, 0.5], 4);
						}

						gl.bindBuffer(gl.UNIFORM_BUFFER, glconf.uniforms.Cell);
						gl.bufferSubData(gl.UNIFORM_BUFFER, 0, cellUboBuffer);
						gl.bindBuffer(gl.UNIFORM_BUFFER, null);
						if (!aux.settings.darkTheme && virusSrc === defaultVirusSrc) {
							// draw default viruses twice as strong for better contrast against light theme
							cellUboFloats[8] = alpha * settings.cellOpacity;
						}
						gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
						return;
					}

					cellUboInts[9] = 0;

					/** @type {[number, number, number, number] | [number, number, number] | undefined} */
					let color = pellet ? foodColor : cellColor;
					if (pellet && foodColor && foodColor[0] === 0 && foodColor[1] === 0 && foodColor[2] === 0) {
						color = [desc.rgb[0], desc.rgb[1], desc.rgb[2], foodColor[3]];
					} else {
						color ??= desc.rgb;
					}

					cellUboFloats[4] = color[0]; cellUboFloats[5] = color[1];
					cellUboFloats[6] = color[2]; cellUboFloats[7] = color[3] ?? 1;

					cellUboInts[9] |= settings.cellOutlines ? 0x02 : 0;
					cellUboInts[9] |= settings.colorUnderSkin ? 0x20 : 0;

					if (!pellet) {
						/** @type {symbol | undefined} */
						let ownerView;
						let ownerVision;
						for (const [otherView, otherVision] of world.views) {
							if (!otherVision.owned.has(cell.id)) continue;
							ownerView = otherView;
							ownerVision = otherVision;
							break;
						}

						if (ownerView === world.selected) {
							const myIndex = ownedArray.indexOf(cell.id);
							if (!canSplit[myIndex]) cellUboInts[9] |= 0x10;
							if (vision.camera.merged) cellUboInts[9] |= 0x04;
						} else if (ownerVision) {
							if (ownerVision.camera.merged) cellUboInts[9] |= 0x08;
						}

						const texture = render.skin(cell);
						if (texture) {
							cellUboInts[9] |= 0x01; // skin
							gl.bindTexture(gl.TEXTURE_2D, texture.texture);
						}
					}

					gl.bindBuffer(gl.UNIFORM_BUFFER, glconf.uniforms.Cell);
					gl.bufferSubData(gl.UNIFORM_BUFFER, 0, cellUboBuffer);
					gl.bindBuffer(gl.UNIFORM_BUFFER, null);
					gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

					// #2 : draw text
					if (pellet) return;
					const name = desc.name || 'An unnamed cell';
					const showThisName = (showNames ?? true) && frame.nr >= 64;
					const showThisMass = aux.settings.showMass && frame.nr >= 64;
					const clan = (settings.clans && aux.clans.get(desc.clan)) || '';
					if (!showThisName && !showThisMass && !clan) return;

					gl.useProgram(glconf.programs.text);
					textUboFloats[8] = alpha; // text_alpha

					let useSilhouette = false;
					if (desc.sub) {
						// text_color1 = #eb9500 * 1.2
						textUboFloats[0] = 0xeb / 255 * 1.2; textUboFloats[1] = 0x95 / 255 * 1.2;
						textUboFloats[2] = 0x00 / 255 * 1.2; textUboFloats[3] = 1;
						// text_color2 = #f9bf0d * 1.2
						textUboFloats[4] = 0xf9 / 255 * 1.2; textUboFloats[5] = 0xbf / 255 * 1.2;
						textUboFloats[6] = 0x0d / 255 * 1.2; textUboFloats[7] = 1;
						useSilhouette = true;
					} else {
						// text_color1 = text_color2 = #fff
						textUboFloats[0] = textUboFloats[1] = textUboFloats[2] = textUboFloats[3] = 1;
						textUboFloats[4] = textUboFloats[5] = textUboFloats[6] = textUboFloats[7] = 1;
					}

					if (input.nick.find(el => el.value === name)) {
						const { nameColor1, nameColor2 } = sigmod.settings;
						if (nameColor1) {
							textUboFloats[0] = nameColor1[0]; textUboFloats[1] = nameColor1[1];
							textUboFloats[2] = nameColor1[2]; textUboFloats[3] = nameColor1[3];
							useSilhouette = true;
						}

						if (nameColor2) {
							textUboFloats[4] = nameColor2[0]; textUboFloats[5] = nameColor2[1];
							textUboFloats[6] = nameColor2[2]; textUboFloats[7] = nameColor2[3];
							useSilhouette = true;
						}
					}

					if (clan) {
						const { aspectRatio, text, silhouette } = textFromCache(clan, useSilhouette);
						if (text) {
							textUboFloats[9] = aspectRatio; // text_aspect_ratio
							textUboFloats[10]
								= showThisName ? settings.clanScaleFactor * 0.5 : settings.nameScaleFactor;
							textUboInts[11] = Number(useSilhouette); // text_silhouette_enabled
							textUboFloats[12] = 0; // text_offset.x
							textUboFloats[13] = showThisName
								? -settings.nameScaleFactor/3 - settings.clanScaleFactor/6 : 0; // text_offset.y

							gl.bindTexture(gl.TEXTURE_2D, text);
							if (silhouette) {
								gl.activeTexture(gl.TEXTURE1);
								gl.bindTexture(gl.TEXTURE_2D, silhouette);
								gl.activeTexture(gl.TEXTURE0);
							}

							gl.bindBuffer(gl.UNIFORM_BUFFER, glconf.uniforms.Text);
							gl.bufferSubData(gl.UNIFORM_BUFFER, 0, textUboBuffer);
							gl.bindBuffer(gl.UNIFORM_BUFFER, null);
							gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
						}
					}

					if (showThisName) {
						const { aspectRatio, text, silhouette } = textFromCache(name, useSilhouette);
						if (text) {
							textUboFloats[9] = aspectRatio; // text_aspect_ratio
							textUboFloats[10] = settings.nameScaleFactor; // text_scale
							textUboInts[11] = Number(useSilhouette); // text_silhouette_enabled
							textUboFloats[12] = textUboFloats[13] = 0; // text_offset = (0, 0)

							gl.bindTexture(gl.TEXTURE_2D, text);
							if (silhouette) {
								gl.activeTexture(gl.TEXTURE1);
								gl.bindTexture(gl.TEXTURE_2D, silhouette);
								gl.activeTexture(gl.TEXTURE0);
							}

							gl.bindBuffer(gl.UNIFORM_BUFFER, glconf.uniforms.Text);
							gl.bufferSubData(gl.UNIFORM_BUFFER, 0, textUboBuffer);
							gl.bindBuffer(gl.UNIFORM_BUFFER, null);
							gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
						}
					}

					if (showThisMass) {
						textUboFloats[8] = alpha * settings.massOpacity; // text_alpha
						textUboFloats[10] = 0.5 * settings.massScaleFactor; // text_scale
						textUboInts[11] = 0; // text_silhouette_enabled

						let yOffset;
						if (showThisName)
							yOffset = (settings.nameScaleFactor + 0.5 * settings.massScaleFactor) / 3;
						else if (clan)
							yOffset = (1 + 0.5 * settings.massScaleFactor) / 3;
						else
							yOffset = 0;
						// draw each digit separately, as Ubuntu makes them all the same width.
						// significantly reduces the size of the text cache
						const mass = Math.floor(frame.nr * frame.nr / 100).toString();
						const maxWidth = maxMassWidth();
						for (let i = 0; i < mass.length; ++i) {
							const { height, width, texture } = massTextFromCache(mass[i]);
							textUboFloats[9] = width / height; // text_aspect_ratio
							// text_offset.x; kerning is fixed by subtracting most of the padding from lineWidth
							textUboFloats[12] = (i - (mass.length - 1) / 2) * settings.massScaleFactor
								* (maxWidth / width)
								* (maxWidth - 20 * settings.textOutlinesFactor * settings.massScaleFactor) / maxWidth;
							textUboFloats[13] = yOffset;
							gl.bindTexture(gl.TEXTURE_2D, texture);

							gl.bindBuffer(gl.UNIFORM_BUFFER, glconf.uniforms.Text);
							gl.bufferSubData(gl.UNIFORM_BUFFER, 0, textUboBuffer);
							gl.bindBuffer(gl.UNIFORM_BUFFER, null);
							gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
						}
					}
				}

				// draw pellets
				{
					// blend function for all pellets
					if (settings.pelletGlow && aux.settings.darkTheme) gl.blendFunc(gl.SRC_ALPHA, gl.ONE);

					// draw unanimated pellets using instanced drawing
					gl.useProgram(glconf.programs.circle);
					gl.bindVertexArray(glconf.vao.pellet.vao);
					let i = 0;
					for (const cell of world.pellets.values()) {
						const frame = world.synchronized ? cell.merged : cell.views.get(world.selected)?.frames[0];
						if (frame?.deadTo !== -1) continue;
						circleBuffers.pelletAlpha[i++] = render.alpha(frame, now);
					}
					gl.bindBuffer(gl.ARRAY_BUFFER, glconf.vao.pellet.alpha);
					gl.bufferSubData(gl.ARRAY_BUFFER, 0, circleBuffers.pelletAlpha);
					gl.bindBuffer(gl.ARRAY_BUFFER, null);

					gl.bindBuffer(gl.UNIFORM_BUFFER, glconf.uniforms.Circle);
					circleUboFloats[0] = 1; // alpha
					circleUboFloats[1] = 0; // scale (0 means no blur)
					gl.bufferSubData(gl.UNIFORM_BUFFER, 0, circleUboFloats);
					gl.bindBuffer(gl.UNIFORM_BUFFER, null);
					// pellet data is not uploaded if tab is closed for a while, so pelletsUploaded would be 0
					gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, circleBuffers.pelletsUploaded);

					if (settings.pelletGlow) {
						// draw unanimated pellet glow
						gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
						circleUboFloats[0] = 0.25; // alpha
						circleUboFloats[1] = 2; // scale
						gl.bindBuffer(gl.UNIFORM_BUFFER, glconf.uniforms.Circle);
						gl.bufferData(gl.UNIFORM_BUFFER, circleUboFloats, gl.STATIC_DRAW);
						gl.bindBuffer(gl.UNIFORM_BUFFER, null);
						gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, i);

						// reset blend func
						gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
					}

					// draw animated pellets without instanced drawing
					gl.bindVertexArray(glconf.vao.main.vao);
					for (const cell of world.pellets.values()) {
						const frame = world.synchronized ? cell.merged : cell.views.get(world.selected)?.frames[0];
						if (frame && frame.deadTo !== -1) draw(cell, true);
						// do not make eaten pellets glow
					}
				}

				// draw cells
				{
					/** @type {[Cell, number][]} */
					const sorted = [];
					for (const cell of world.cells.values()) {
						const frame = world.synchronized ? cell.merged : cell.views.get(world.selected)?.frames[0];
						const interp = world.synchronized ? cell.merged : cell.views.get(world.selected);
						if (!frame || !interp) continue;

						const a = Math.min(Math.max((now - interp.updated) / settings.drawDelay, 0), 1);
						const computedR = interp.or + (frame.nr - interp.or) * a;
						sorted.push([cell, computedR]);
					}

					gl.bindVertexArray(glconf.vao.main.vao);
					sorted.sort(([_a, ar], [_b, br]) => ar - br);
					for (const [cell] of sorted) draw(cell, false);

					// draw glow *after* all cells (so the glow goes above the text)
					if (settings.cellGlow) {
						render.upload(false);
						let i = 0;
						for (const cell of world.cells.values()) {
							const frame = world.synchronized ? cell.merged : cell.views.get(world.selected)?.frames[0];
							/** @type {CellDescription} */
							const desc = world.synchronized ? cell.views.values().next().value : cell.views.get(world.selected);
							if (!frame || !desc || desc.jagged) continue;

							let alpha = render.alpha(frame, now);
							// it looks kinda weird when cells get sucked in when being eaten
							if (frame.deadTo !== -1) alpha *= 0.25;
							circleBuffers.cellAlpha[i++] = alpha;
						}

						gl.useProgram(glconf.programs.circle);
						gl.bindVertexArray(glconf.vao.cell.vao);
						gl.blendFunc(gl.SRC_ALPHA, gl.ONE);

						gl.bindBuffer(gl.ARRAY_BUFFER, glconf.vao.cell.alpha);
						gl.bufferSubData(gl.ARRAY_BUFFER, 0, circleBuffers.cellAlpha);
						gl.bindBuffer(gl.ARRAY_BUFFER, null);

						circleUboFloats[0] = 0.25; // alpha
						// scale (can't be too big, otherwise it looks weird when cells come into view)
						circleUboFloats[1] = 1.5;
						gl.bindBuffer(gl.UNIFORM_BUFFER, glconf.uniforms.Circle);
						gl.bufferData(gl.UNIFORM_BUFFER, circleUboFloats, gl.STATIC_DRAW);
						gl.bindBuffer(gl.UNIFORM_BUFFER, null);
						gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, i);

						gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
					}
				}

				// draw tracers
				if (settings.tracer) {
					gl.useProgram(glconf.programs.tracer);
					gl.bindVertexArray(glconf.vao.tracer.vao);

					tracerUboFloats[0] = 0.5; // #7f7f7f color
					tracerUboFloats[1] = 0.5;
					tracerUboFloats[2] = 0.5;
					tracerUboFloats[3] = 0.5;
					tracerUboFloats[4] = 2; // line thickness
					gl.bindBuffer(gl.UNIFORM_BUFFER, glconf.uniforms.Tracer);
					gl.bufferSubData(gl.UNIFORM_BUFFER, 0, tracerUboFloats);
					gl.bindBuffer(gl.UNIFORM_BUFFER, null);

					const mouse = input.toWorld(world.selected, input.current);
					const inputs = input.views.get(world.selected);
					if (!inputs) return; // tracers are the last step in cells(), so a return is OK

					// resize by powers of 2
					let capacity = tracerFloats.length || 1;
					while (vision.owned.size * 4 > capacity) capacity *= 2;
					const resizing = capacity !== tracerFloats.length;
					if (resizing) tracerFloats = new Float32Array(capacity);

					const camera
						= world.singleCamera(world.selected, vision, settings.camera !== 'default' ? 2 : 0, now);

					let i = 0;
					for (const id of vision.owned) {
						const cell = world.cells.get(id);
						const frame = world.synchronized ? cell?.merged : cell?.views.get(world.selected)?.frames[0];
						const interp = world.synchronized ? cell?.merged : cell?.views.get(world.selected);
						if (!frame || !interp || frame.deadAt !== undefined) continue;

						const { x, y } = world.xyr(frame, interp, undefined, undefined, false, now);
						tracerFloats[i * 4] = x;
						tracerFloats[i * 4 + 1] = y;
						tracerFloats[i * 4 + 2] = mouse[0];
						tracerFloats[i * 4 + 3] = mouse[1];

						switch (inputs.lock?.type) {
							case 'point':
								if (now > inputs.lock.until) break;
								tracerFloats[i * 4 + 2] = inputs.lock.world[0];
								tracerFloats[i * 4 + 3] = inputs.lock.world[1];
								break;
							case 'horizontal':
								tracerFloats[i * 4 + 3] = inputs.lock.world[1];
								break;
							case 'vertical':
								tracerFloats[i * 4 + 2] = inputs.lock.world[0];
								break;
							case 'fixed':
								const dx = mouse[0] - camera.sumX / camera.weight;
								const dy = mouse[1] - camera.sumY / camera.weight;
								const d = Math.hypot(dx, dy);
								tracerFloats[i * 4 + 2] = x + dx * 1e6 / d;
								tracerFloats[i * 4 + 3] = y + dy * 1e6 / d;
						}
						++i;
					}

					gl.bindBuffer(gl.ARRAY_BUFFER, glconf.vao.tracer.line);
					if (resizing) gl.bufferData(gl.ARRAY_BUFFER, tracerFloats, gl.STATIC_DRAW);
					else gl.bufferSubData(gl.ARRAY_BUFFER, 0, tracerFloats);
					gl.bindBuffer(gl.ARRAY_BUFFER, null);
					gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, i);
				}
			})();

			ui.stats.update(world.selected);

			(function minimap() {
				if (now - lastMinimapDraw < 40) return; // should be good enough when multiboxing, may change later
				lastMinimapDraw = now;

				if (!aux.settings.showMinimap) {
					ui.minimap.canvas.style.display = 'none';
					return;
				} else {
					ui.minimap.canvas.style.display = '';
				}

				const { canvas, ctx } = ui.minimap;
				// clears the canvas
				const canvasLength = canvas.width = canvas.height = Math.ceil(200 * (devicePixelRatio - 0.0001));
				const sectorSize = canvas.width / 5;

				// always use this style for drawing section and minimap names
				ctx.font = `${Math.floor(sectorSize / 3)}px "${sigmod.settings.font || 'Ubuntu'}", Ubuntu`;
				ctx.textAlign = 'center';
				ctx.textBaseline = 'middle';

				// cache the background if necessary (25 texts = bad)
				if (minimapCache && minimapCache.bg.width === canvasLength
					&& minimapCache.darkTheme === aux.settings.darkTheme) {
					ctx.putImageData(minimapCache.bg, 0, 0);
				} else {
					// draw section names
					ctx.fillStyle = '#fff';
					ctx.globalAlpha = aux.settings.darkTheme ? 0.3 : 0.7;

					const cols = ['1', '2', '3', '4', '5'];
					const rows = ['A', 'B', 'C', 'D', 'E'];
					cols.forEach((col, y) => {
						rows.forEach((row, x) => {
							ctx.fillText(row + col, (x + 0.5) * sectorSize, (y + 0.5) * sectorSize);
						});
					});

					minimapCache = {
						bg: ctx.getImageData(0, 0, canvas.width, canvas.height),
						darkTheme: aux.settings.darkTheme,
					};
				}

				const { border } = vision;
				if (!border) return;

				// sigmod overlay resizes itself differently, so we correct it whenever we need to
				/** @type {HTMLCanvasElement | null} */
				const sigmodMinimap = document.querySelector('canvas.minimap');
				if (sigmodMinimap) {
					// we need to check before updating the canvas, otherwise we will clear it
					if (sigmodMinimap.style.width !== '200px' || sigmodMinimap.style.height !== '200px')
						sigmodMinimap.style.width = sigmodMinimap.style.height = '200px';

					if (sigmodMinimap.width !== canvas.width || sigmodMinimap.height !== canvas.height)
						sigmodMinimap.width = sigmodMinimap.height = canvas.width;
				}

				const gameWidth = (border.r - border.l);
				const gameHeight = (border.b - border.t);

				// highlight current section
				ctx.fillStyle = settings.theme[3] ? aux.rgba2hex6(...settings.theme) : '#ff0';
				ctx.globalAlpha = 0.3;

				const sectionX = Math.floor((vision.camera.x - border.l) / gameWidth * 5);
				const sectionY = Math.floor((vision.camera.y - border.t) / gameHeight * 5);
				ctx.fillRect(sectionX * sectorSize, sectionY * sectorSize, sectorSize, sectorSize);

				ctx.globalAlpha = 1;

				// draw cells
				/**
				 * @param {{ nx: number, ny: number, nr: number }} frame
				 * @param {{ rgb: [number, number, number] | [number, number, number, number] }} desc
				 */
				const drawCell = (frame, desc) => {
					const x = (frame.nx - border.l) / gameWidth * canvas.width;
					const y = (frame.ny - border.t) / gameHeight * canvas.height;
					const r = Math.max(frame.nr / gameWidth * canvas.width, 2);

					ctx.scale(0.01, 0.01); // prevent sigmod from treating minimap cells as pellets
					ctx.fillStyle = aux.rgba2hex6(desc.rgb[0], desc.rgb[1], desc.rgb[2], 1);
					ctx.beginPath();
					ctx.moveTo((x + r) * 100, y * 100);
					ctx.arc(x * 100, y * 100, r * 100, 0, 2 * Math.PI);
					ctx.fill();
					ctx.resetTransform();
				};

				/**
				 * @param {number} x
				 * @param {number} y
				 * @param {string} name
				 */
				const drawName = function drawName(x, y, name) {
					x = (x - border.l) / gameWidth * canvas.width;
					y = (y - border.t) / gameHeight * canvas.height;

					ctx.fillStyle = '#fff';
					// add a space to prevent sigmod from detecting names
					ctx.fillText(name + ' ', x, y - 7 * devicePixelRatio - sectorSize / 6);
				};

				// draw clanmates (and other tabs) first, below yourself
				// clanmates are grouped by name AND color, ensuring they stay separate
				/** @type {Map<string, { name: string, n: number, x: number, y: number }>} */
				const avgPos = new Map();
				for (const cell of world.cells.values()) {
					const frame = world.synchronized ? cell.merged : cell.views.get(world.selected)?.frames[0];
					/** @type {CellDescription} */
					const desc = world.synchronized ? cell.views.values().next().value : cell.views.get(world.selected);
					if (!frame || !desc || frame.deadAt !== undefined) continue;

					let ownedByOther = false;
					for (const [view, vision] of world.views) {
						if (view === world.selected) continue;
						ownedByOther = vision.owned.has(cell.id) && frame.born >= vision.spawned;
						if (ownedByOther) break;
					}
					if ((!desc.clan || desc.clan !== aux.userData?.clan) && !ownedByOther) continue;

					drawCell(frame, desc);

					const name = desc.name || 'An unnamed cell';
					const hash = desc.name + (desc.rgb[0] * 65536 + desc.rgb[1] * 256 + desc.rgb[2]);
					const entry = avgPos.get(hash);
					if (entry) {
						++entry.n;
						entry.x += frame.nx;
						entry.y += frame.ny;
					} else {
						avgPos.set(hash, { name, n: 1, x: frame.nx, y: frame.ny });
					}
				}

				avgPos.forEach(entry => {
					drawName(entry.x / entry.n, entry.y / entry.n, entry.name);
				});

				// draw my cells above everyone else
				let myName = '';
				let ownN = 0;
				let ownX = 0;
				let ownY = 0;
				for (const id of vision.owned) {
					const cell = world.cells.get(id);
					const frame = world.synchronized ? cell?.merged : cell?.views.get(world.selected)?.frames[0];
					const desc = world.synchronized ? cell?.views.values().next().value : cell?.views.get(world.selected);
					if (!frame || !desc || frame.deadAt !== undefined) continue;

					drawCell(frame, desc);
					myName = desc.name || 'An unnamed cell';
					++ownN;
					ownX += frame.nx;
					ownY += frame.ny;
				}

				if (ownN <= 0) {
					// if no cells were drawn, draw our spectate pos instead
					drawCell({ nx: vision.camera.x, ny: vision.camera.y, nr: gameWidth / canvas.width * 5, },
						{ rgb: settings.theme[3] ? settings.theme : [1, 0.6, 0.6] });
				} else {
					ownX /= ownN;
					ownY /= ownN;
					// draw name above player's cells
					drawName(ownX, ownY, myName);

					// send a hint to sigmod
					ctx.globalAlpha = 0;
					ctx.fillText(`X: ${ownX}, Y: ${ownY}`, 0, -1000);
				}
			})();

			requestAnimationFrame(renderGame);
		}

		requestAnimationFrame(renderGame);
		return render;
	})();



	// @ts-expect-error for debugging purposes and other scripts. dm me on discord @ 8y8x to guarantee stability
	window.sigfix = {
		destructor, aux, sigmod, ui, settings, world, net, input, glconf, render,
	};
})();
