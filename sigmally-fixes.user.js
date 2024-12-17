// ==UserScript==
// @name         Sigmally Fixes V2
// @version      2.4.1-BETA
// @description  Easily 3X your FPS on Sigmally.com + many bug fixes + great for multiboxing + supports SigMod
// @author       8y8x
// @match        https://*.sigmally.com/*
// @license      MIT
// @grant        none
// @namespace    https://8y8x.dev/sigmally-fixes
// @icon         https://raw.githubusercontent.com/8y8x/sigmally-fixes/refs/heads/main/icon.png
// @compatible   chrome Recommended for all users, works perfectly out of the box
// @compatible   opera Works fine, multiboxers may need to change some browser keybinds
// @compatible   edge Works fine, multiboxers may need to change some browser keybinds
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

(async () => {
	const sfVersion = '2.4.1-BETA';
	// yes, this actually makes a significant difference
	const undefined = window.undefined;

	////////////////////////////////
	// Define Auxiliary Functions //
	////////////////////////////////
	const aux = (() => {
		const aux = {};

		/** @type {Map<string, string>} */
		aux.clans = new Map();
		function fetchClans() {
			fetch('https://sigmally.com/api/clans').then(r => r.json()).then(r => {
				if (r.status !== 'success') {
					setTimeout(() => fetchClans(), 10_000);
					return;
				}

				aux.clans.clear();
				r.data.forEach(clan => {
					if (typeof clan._id !== 'string' || typeof clan.name !== 'string') return;
					aux.clans.set(clan._id, clan.name);
				});

				// does not need to be updated often, but just enough so people who leave their tab open don't miss out
				setTimeout(() => fetchClans(), 600_000);
			}).catch(err => {
				console.warn('Error while fetching clans:', err);
				setTimeout(() => fetchClans(), 10_000);
			});
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
				err = '[Sigmally Fixes]: ' + err;
				prompt(err, err); // use prompt, so people can paste the error message into google translate
				throw err;
			}

			return /** @type {any} */ (x);
		};

		/**
		 * consistent exponential easing relative to 60fps.
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
		 * @param {number} off
		 * @returns {[string, number]}
		 */
		aux.readZTString = (dat, off) => {
			const startOff = off;
			for (; off < dat.byteLength; ++off) {
				if (dat.getUint8(off) === 0) break;
			}

			return [aux.textDecoder.decode(new DataView(dat.buffer, startOff, off - startOff)), off + 1];
		};

		/** @type {{
		 * 	cellColor?: [number, number, number, number],
		 * 	foodColor?: [number, number, number, number],
		 * 	mapColor?: [number, number, number, number],
		 * 	outlineColor?: [number, number, number, number],
		 * 	nameColor1?: [number, number, number, number],
		 * 	nameColor2?: [number, number, number, number],
		 * 	hidePellets?: boolean,
		 * 	rapidFeedKey?: string,
		 * 	removeOutlines?: boolean,
		 * 	showNames?: boolean,
		 * 	skinReplacement?: { original: string | null, replacement?: string | null, replaceImg?: string | null },
		 * 	virusImage?: string,
		 * } | undefined} */
		aux.sigmodSettings = undefined;
		setInterval(() => {
			// @ts-expect-error
			const sigmod = window.sigmod?.settings;
			if (sigmod) {
				let sigmodSettings = aux.sigmodSettings = {};
				/**
				 * @param {'cellColor' | 'foodColor' | 'mapColor' | 'outlineColor' | 'nameColor1' | 'nameColor2'} prop
				 * @param {any[]} lookups
				 */
				const applyColor = (prop, lookups) => {
					for (const lookup of lookups) {
						if (lookup) {
							sigmodSettings[prop] = aux.hex2rgba(lookup);
							return;
						}
					}
				};
				applyColor('cellColor', [sigmod.game?.cellColor]);
				applyColor('foodColor', [sigmod.game?.foodColor]);
				applyColor('mapColor', [sigmod.game?.map?.color, sigmod.mapColor]);
				// sigmod treats the map border as cell borders for some reason
				if (!['#00f', '#00f0', '#0000ff', '#000000ffff'].includes(sigmod.game?.borderColor))
					applyColor('outlineColor', [sigmod.game?.borderColor]);
				// note: singular nameColor takes priority
				applyColor('nameColor1', [
					sigmod.game?.name?.color,
					sigmod.game?.name?.gradient?.enabled && sigmod.game.name.gradient.left,
				]);
				applyColor('nameColor2', [
					sigmod.game?.name?.color,
					sigmod.game?.name?.gradient?.enabled && sigmod.game.name.gradient.right,
				]);
				// v10 does not have a 'hide food' setting; check food's transparency
				aux.sigmodSettings.hidePellets = aux.sigmodSettings.foodColor?.[3] === 0;
				aux.sigmodSettings.removeOutlines = sigmod.game?.removeOutlines;
				aux.sigmodSettings.skinReplacement = sigmod.game?.skins;
				aux.sigmodSettings.virusImage = sigmod.game?.virusImage;
				aux.sigmodSettings.rapidFeedKey = sigmod.macros?.keys?.rapidFeed;
				// sigmod's showNames setting is always "true" interally (i think??)
				aux.sigmodSettings.showNames = aux.setting('input#showNames', true);
			}
		}, 200);

		// patch some sigmod bugs
		let patchSigmodInterval;
		patchSigmodInterval = setInterval(() => {
			const sigmod = /** @type {any} */ (window).sigmod;
			if (!sigmod) return;

			clearInterval(patchSigmodInterval);

			// anchor chat and minimap to the screen, so scrolling to zoom doesn't move them
			// it's possible that cursed will change something at any time so i'm being safe here
			const minimapContainer = /** @type {HTMLElement | null} */ (document.querySelector('.minimapContainer'));
			if (minimapContainer) minimapContainer.style.position = 'fixed';

			const modChat = /** @type {HTMLElement | null} */ (document.querySelector('.modChat'));
			if (modChat) modChat.style.position = 'fixed';
		}, 500);

		/**
		 * @param {string} selector
		 * @param {boolean} value
		 */
		aux.setting = (selector, value) => {
			/** @type {HTMLInputElement | null} */
			const el = document.querySelector(selector);
			return el ? el.checked : value;
		};

		const settings = () => {
			try {
				// current skin is saved in localStorage
				aux.settings = JSON.parse(localStorage.getItem('settings') ?? '');
			} catch (_) {
				aux.settings = /** @type {any} */ ({});
			}

			// sigmod forces dark theme to be enabled
			if (aux.sigmodSettings) {
				// sigmod doesn't have a checkbox for dark theme, so we infer it from the custom map color
				const { mapColor } = aux.sigmodSettings;
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
		aux.settings = settings();
		setInterval(settings, 250);
		// apply saved gamemode because sigmally fixes connects before the main game even loads
		if (aux.settings?.gamemode) {
			/** @type {HTMLSelectElement | null} */
			const gamemode = document.querySelector('select#gamemode');
			if (gamemode)
				gamemode.value = aux.settings.gamemode;
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
			while (trimCtx.measureText(text).width > 250)
				text = text.slice(0, -1);

			return text;
		};

		/*
			If you have Sigmally open in two tabs and you're playing with an account, one has an outdated token while
			the other has the latest one. This causes problems because the tab with the old token does not work properly
			during the game (skin, XP) To fix this, the latest token is sent to the previously opened tab. This way you
			can collect XP in both tabs and use your selected skin.
			@czrsd
		*/
		/** @type {{ token: string, updated: number } | undefined} */
		aux.token = undefined;
		const tokenChannel = new BroadcastChannel('sigfix-token');
		tokenChannel.addEventListener('message', msg => {
			/** @type {{ token: string, updated: number }} */
			const token = msg.data;
			if (!aux.token || aux.token.updated < token.updated)
				aux.token = token;
		});

		/** @type {object | undefined} */
		aux.userData = undefined;
		aux.oldFetch = fetch.bind(window);
		// this is the best method i've found to get the userData object, since game.js uses strict mode
		Object.defineProperty(window, 'fetch', {
			value: new Proxy(fetch, {
				apply: (target, thisArg, args) => {
					let url = args[0];
					const data = args[1];
					if (typeof url === 'string') {
						if (url.includes('/server/recaptcha/v3'))
							return new Promise(() => { }); // block game.js from attempting to go through captcha flow

						// game.js doesn't think we're connected to a server, we default to eu0 because that's the
						// default everywhere else
						if (url.includes('/userdata/')) url = url.replace('///', '//eu0.sigmally.com/server/');

						// patch the current token in the url and body of the request
						if (aux.token) {
							// 128 hex characters surrounded by non-hex characters (lookahead and lookbehind)
							const tokenTest = /(?<![0-9a-fA-F])[0-9a-fA-F]{128}(?![0-9a-fA-F])/g;
							url = url.replaceAll(tokenTest, aux.token.token);
							if (typeof data?.body === 'string')
								data.body = data.body.replaceAll(tokenTest, aux.token.token);
						}

						args[0] = url;
						args[1] = data;
					}

					return target.apply(thisArg, args).then(res => new Proxy(res, {
						get: (target, prop, _receiver) => {
							if (prop !== 'json') {
								const val = target[prop];
								if (typeof val === 'function')
									return val.bind(target);
								else
									return val;
							}

							return () => target.json().then(obj => {
								if (obj?.body?.user) {
									aux.userData = obj.body.user;
									// NaN if invalid / undefined
									let updated = Number(new Date(aux.userData.updateTime));
									if (Number.isNaN(updated))
										updated = Date.now();

									if (!aux.token || updated >= aux.token.updated) {
										aux.token = { token: aux.userData.token, updated };
										tokenChannel.postMessage(aux.token);
									}
								}

								return obj;
							});
						},
					}));
				},
			}),
		});

		/** @param {number} ms */
		aux.wait = ms => new Promise(resolve => setTimeout(resolve, ms));

		return aux;
	})();



	////////////////////////
	// Destroy Old Client //
	////////////////////////
	const destructor = (() => {
		const destructor = {};
		// #1 : kill the rendering process
		const oldRQA = requestAnimationFrame;
		window.requestAnimationFrame = function (fn) {
			try {
				throw new Error();
			} catch (err) {
				// prevent drawing the game, but do NOT prevent saving settings (which is called on RQA)
				if (!err.stack.includes('/game.js') || err.stack.includes('HTML'))
					return oldRQA(fn);
			}

			return -1;
		};

		// #2 : kill access to using a WebSocket
		destructor.realWebSocket = WebSocket;
		Object.defineProperty(window, 'WebSocket', {
			value: new Proxy(WebSocket, {
				construct(_target, argArray, _newTarget) {
					if (argArray[0]?.includes('sigmally.com')) {
						throw new Error('Nope :) - hooked by Sigmally Fixes');
					}

					// @ts-expect-error
					return new destructor.realWebSocket(...argArray);
				},
			}),
		});

		/** @type {{ status: 'left' | 'pending', started: number } | undefined} */
		destructor.respawnBlock = undefined;

		const cmdRepresentation = new TextEncoder().encode('/leaveworld').toString();
		/** @type {WeakSet<WebSocket>} */
		destructor.safeWebSockets = new WeakSet();
		destructor.realWsSend = WebSocket.prototype.send;
		WebSocket.prototype.send = function (x) {
			if (!destructor.safeWebSockets.has(this) && this.url.includes('sigmally.com')) {
				this.onclose = null;
				this.close();
				throw new Error('Nope :) - hooked by Sigmally Fixes');
			}

			if (settings.blockNearbyRespawns) {
				let buf;
				if (x instanceof ArrayBuffer) buf = x;
				else if (x instanceof DataView) buf = x.buffer;
				else if (x instanceof Uint8Array) buf = x.buffer;

				if (buf && buf.byteLength === '/leaveworld'.length + 3
					&& new Uint8Array(buf).toString().includes(cmdRepresentation)) {
					// block respawns if we haven't actually respawned yet (with a 500ms max in case something fails)
					if (performance.now() - (destructor.respawnBlock?.started ?? -Infinity) < 500) return;
					destructor.respawnBlock = undefined;
					// trying to respawn; see if we are nearby an alive multi-tab
					if (world.mine.length > 0) {
						world.moveCamera();
						for (const data of sync.others.values()) {
							const d = Math.hypot(data.camera.tx - world.camera.tx, data.camera.ty - world.camera.ty);
							if (data.owned.size > 0 && d <= 7500)
								return;
						}
					}

					// we are allowing a respawn, take note
					destructor.respawnBlock = { status: 'pending', started: performance.now() };
				}
			}

			return destructor.realWsSend.apply(this, arguments);
		};

		// #3 : prevent keys from being registered by the game
		setInterval(() => {
			onkeydown = null;
			onkeyup = null;
		}, 50);

		return destructor;
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
			fetch('https://raw.githubusercontent.com/8y8x/sigmally-fixes/main/versions.json')
				.then(res => res.json())
				.then(res => {
					if (sfVersion in res && !res[sfVersion].ok && res[sfVersion].alert) {
						const color = res[sfVersion].color || '#f00';
						const box = document.createElement('div');
						box.style.cssText = `background: ${color}3; border: 1px solid ${color}; width: 100%; \
							height: fit-content; font-size: 1em; padding: 5px; margin: 5px 0; border-radius: 3px; \
							color: ${color}`;
						box.innerHTML = String(res[sfVersion].alert)
							.replace(/\<|\>/g, '') // never allow html tag injection
							.replace(/\{link\}/g, '<a href="https://greasyfork.org/scripts/483587">[click here]</a>')
							.replace(/\{autolink\}/g, '<a href="\
								https://update.greasyfork.org/scripts/483587/Sigmally%20Fixes%20V2.user.js">\
								[click here]</a>');

						watermark.insertAdjacentElement('afterend', box);
					}
				})
				.catch(err => console.warn('Failed to check Sigmally Fixes version:', err));
		})();

		ui.game = (() => {
			const game = {};

			/** @type {HTMLCanvasElement | null} */
			const oldCanvas = document.querySelector('canvas#canvas');
			if (!oldCanvas) {
				throw 'exiting script - no canvas found';
			}

			const newCanvas = document.createElement('canvas');
			newCanvas.id = 'sf-canvas';
			newCanvas.style.cssText = `background: #003; width: 100vw; height: 100vh; position: fixed; top: 0; left: 0;
				z-index: 1;`;
			game.canvas = newCanvas;
			(document.querySelector('body div') ?? document.body).appendChild(newCanvas);

			// leave the old canvas so the old client can actually run
			oldCanvas.style.display = 'none';

			// forward macro inputs from the canvas to the old one - this is for sigmod mouse button controls
			newCanvas.addEventListener('mousedown', e => oldCanvas.dispatchEvent(new MouseEvent('mousedown', e)));
			newCanvas.addEventListener('mouseup', e => oldCanvas.dispatchEvent(new MouseEvent('mouseup', e)));
			// forward mouse movements from the old canvas to the window - this is for sigmod keybinds that move
			// the mouse
			oldCanvas.addEventListener('mousemove', e => dispatchEvent(new MouseEvent('mousemove', e)));

			const gl = aux.require(
				newCanvas.getContext('webgl2', { alpha: false, depth: false }),
				'Couldn\'t get WebGL2 context. Possible causes:\r\n' +
				'- Maybe GPU/Hardware acceleration needs to be enabled in your browser settings; \r\n' +
				'- Maybe your browser is just acting weird and it might fix itself after a restart; \r\n' +
				'- Maybe your GPU drivers are exceptionally old.',
			);

			game.gl = gl;

			// indicate that we will restore the context
			newCanvas.addEventListener('webglcontextlost', e => {
				e.preventDefault(); // signal that we want to restore the context
				// cleanup old caches (after render), as we can't do this within initWebGL()
				render.resetTextCache();
				render.resetTextureCache();
			});
			newCanvas.addEventListener('webglcontextrestored', () => glconf.init());

			function resize() {
				newCanvas.width = Math.ceil(innerWidth * devicePixelRatio);
				newCanvas.height = Math.ceil(innerHeight * devicePixelRatio);
				game.gl.viewport(0, 0, newCanvas.width, newCanvas.height);
			}

			addEventListener('resize', resize);
			resize();

			return game;
		})();

		ui.stats = (() => {
			const container = document.createElement('div');
			container.style.cssText = 'position: fixed; top: 10px; left: 10px; width: 400px; height: fit-content; \
				user-select: none; z-index: 2; transform-origin: top left;';
			document.body.appendChild(container);

			const score = document.createElement('div');
			score.style.cssText = 'font-family: Ubuntu; font-size: 30px; color: #fff; line-height: 1.0;';
			container.appendChild(score);

			const measures = document.createElement('div');
			measures.style.cssText = 'font-family: Ubuntu; font-size: 20px; color: #fff; line-height: 1.1;';
			container.appendChild(measures);

			const misc = document.createElement('div');
			// white-space: pre; allows using \r\n to insert line breaks
			misc.style.cssText = 'font-family: Ubuntu; font-size: 14px; color: #fff; white-space: pre; \
				line-height: 1.1; opacity: 0.5;';
			container.appendChild(misc);

			let statsLastUpdated = performance.now();
			const update = () => {
				let color = aux.settings.darkTheme ? '#fff' : '#000';
				score.style.color = color;
				measures.style.color = color;
				misc.style.color = color;

				score.style.fontWeight = measures.style.fontWeight = settings.boldUi ? 'bold' : 'normal';
				measures.style.opacity = settings.showStats ? '1' : '0.5';
				misc.style.opacity = settings.showStats ? '0.5' : '0';

				statsLastUpdated = performance.now();
				if ((aux.sigmodSettings?.showNames ?? true) && world.leaderboard.length > 0)
					ui.leaderboard.container.style.display = '';
				else {
					ui.leaderboard.container.style.display = 'none';
				}

				let scoreVal = 0;
				for (const id of world.mine) {
					const cell = world.cells.get(id);
					if (cell) {
						// we use nr because this is what the server sees; interpolated mass is irrelevant
						// we also floor every cell individually, so the score matches what you could count yourself
						scoreVal += Math.floor(cell.nr * cell.nr / 100);
					}
				}
				if (typeof aux.userData?.boost === 'number' && aux.userData.boost > Date.now())
					scoreVal *= 2;
				if (scoreVal > world.stats.highestScore) {
					world.stats.highestScore = scoreVal;
				}

				score.textContent = scoreVal > 0 ? ('Score: ' + Math.floor(scoreVal)) : '';

				let measuresText = `${Math.floor(render.fps)} FPS`;
				if (net.latency !== undefined) {
					if (net.latency === -1)
						measuresText += ' ????ms ping';
					else
						measuresText += ` ${Math.floor(net.latency)}ms ping`;
				}

				measures.textContent = measuresText;
			};
			// if the player starts lagging, we still need to update the stats
			setInterval(() => {
				if (performance.now() - statsLastUpdated > 250)
					update();
			}, 250);

			/** @param {object} statData */
			function updateMisc(statData) {
				let uptime;
				if (statData.uptime < 60) {
					uptime = '<1min';
				} else {
					uptime = Math.floor(statData.uptime / 60 % 60) + 'min';
					if (statData.uptime >= 60 * 60)
						uptime = Math.floor(statData.uptime / 60 / 60 % 24) + 'hr ' + uptime;
					if (statData.uptime >= 24 * 60 * 60)
						uptime = Math.floor(statData.uptime / 24 / 60 / 60 % 60) + 'd ' + uptime;
				}

				misc.textContent = [
					`${statData.name} (${statData.mode})`,
					`${statData.playersTotal} / ${statData.playersLimit} players`,
					`${statData.playersAlive} playing`,
					`${statData.playersSpect} spectating`,
					`${(statData.update * 2.5).toFixed(1)}% load @ ${uptime}`,
				].join('\r\n');
			}

			function matchTheme() {
				let color = aux.settings.darkTheme ? '#fff' : '#000';
				score.style.color = color;
				measures.style.color = color;
				misc.style.color = color;
			}

			matchTheme();

			return { container, score, measures, misc, update, updateMisc, matchTheme };
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
			linesContainer.style.cssText = 'font-family: Ubuntu; font-size: 20px; line-height: 1.2; width: 100%; \
				height: fit-content; text-align: center; white-space: pre; overflow: hidden;';
			container.appendChild(linesContainer);

			const lines = [];
			for (let i = 0; i < 11; ++i) {
				const line = document.createElement('div');
				line.style.display = 'none';
				linesContainer.appendChild(line);
				lines.push(line);
			}

			function update() {
				const friends = /** @type {any} */ (window).sigmod?.friend_names;
				const friendSettings = /** @type {any} */ (window).sigmod?.friends_settings;
				world.leaderboard.forEach((entry, i) => {
					const line = lines[i];
					if (!line) return;

					line.style.display = 'block';
					line.textContent = `${entry.place ?? i + 1}. ${entry.name || 'An unnamed cell'}`;
					if (entry.me)
						line.style.color = '#faa';
					else if (friends instanceof Set && friends.has(entry.name) && friendSettings?.highlight_friends)
						line.style.color = friendSettings.highlight_color;
					else if (entry.sub)
						line.style.color = '#ffc826';
					else
						line.style.color = '#fff';
				});

				for (let i = world.leaderboard.length; i < lines.length; ++i)
					lines[i].style.display = 'none';

				container.style.fontWeight = settings.boldUi ? 'bold' : 'normal';
			}

			return { container, title, linesContainer, lines, update };
		})();

		/** @type {HTMLElement} */
		const mainMenu = aux.require(
			document.querySelector('#__line1')?.parentElement,
			'Can\'t find the main menu UI. Try reloading the page?',
		);

		/** @type {HTMLElement} */
		const statsContainer = aux.require(
			document.querySelector('#__line2'),
			'Can\'t find the death screen UI. Try reloading the page?',
		);

		/** @type {HTMLElement} */
		const continueButton = aux.require(
			document.querySelector('#continue_button'),
			'Can\'t find the continue button (on death). Try reloading the page?',
		);

		/** @type {HTMLElement | null} */
		const menuLinks = document.querySelector('#menu-links');
		/** @type {HTMLElement | null} */
		const overlay = document.querySelector('#overlays');

		// sigmod uses this to detect if the menu is closed or not, otherwise this is unnecessary
		/** @type {HTMLElement | null} */
		const menuWrapper = document.querySelector('#menu-wrapper');

		let escOverlayVisible = true;
		/**
		 * @param {boolean} [show]
		 */
		ui.toggleEscOverlay = show => {
			escOverlayVisible = show ?? !escOverlayVisible;
			if (escOverlayVisible) {
				mainMenu.style.display = '';
				if (overlay) overlay.style.display = '';
				if (menuLinks) menuLinks.style.display = '';
				if (menuWrapper) menuWrapper.style.display = '';

				ui.deathScreen.hide();
			} else {
				mainMenu.style.display = 'none';
				if (overlay) overlay.style.display = 'none';
				if (menuLinks) menuLinks.style.display = 'none';
				if (menuWrapper) menuWrapper.style.display = 'none';
			}
		};

		ui.escOverlayVisible = () => escOverlayVisible;

		ui.deathScreen = (() => {
			const deathScreen = {};

			continueButton.addEventListener('click', () => {
				ui.toggleEscOverlay(true);
			});

			// i'm not gonna buy a boost to try and figure out how this thing works
			/** @type {HTMLElement | null} */
			const bonus = document.querySelector('#menu__bonus');
			if (bonus) bonus.style.display = 'none';

			/**
			 * @param {{ foodEaten: number, highestScore: number, highestPosition: number,
			 * spawnedAt: number | undefined }} stats
			 */
			deathScreen.show = stats => {
				const foodEatenElement = document.querySelector('#food_eaten');
				if (foodEatenElement)
					foodEatenElement.textContent = stats.foodEaten.toString();

				const highestMassElement = document.querySelector('#highest_mass');
				if (highestMassElement)
					highestMassElement.textContent = Math.round(stats.highestScore).toString();

				const highestPositionElement = document.querySelector('#top_leaderboard_position');
				if (highestPositionElement)
					highestPositionElement.textContent = stats.highestPosition.toString();

				const timeAliveElement = document.querySelector('#time_alive');
				if (timeAliveElement) {
					let time;
					if (stats.spawnedAt === undefined)
						time = 0;
					else
						time = (performance.now() - stats.spawnedAt) / 1000;
					const hours = Math.floor(time / 60 / 60);
					const mins = Math.floor(time / 60 % 60);
					const seconds = Math.floor(time % 60);

					timeAliveElement.textContent = `${hours ? hours + ' h' : ''} ${mins ? mins + ' m' : ''} `
						+ `${seconds ? seconds + ' s' : ''}`;
				}

				statsContainer.classList.remove('line--hidden');
				ui.toggleEscOverlay(false);
				if (overlay) overlay.style.display = '';

				stats.foodEaten = 0;
				stats.highestScore = 0;
				stats.highestPosition = 0;
				stats.spawnedAt = undefined;

				// refresh ads... ...yep
				const { adSlot4, adSlot5, adSlot6, googletag } = /** @type {any} */ (window);
				if (googletag) {
					googletag.cmd.push(() => googletag.display(adSlot4));
					googletag.cmd.push(() => googletag.display(adSlot5));
					googletag.cmd.push(() => googletag.display(adSlot6));
				}
			};

			deathScreen.hide = () => {
				const shown = !statsContainer?.classList.contains('line--hidden');
				statsContainer?.classList.add('line--hidden');
				const { googletag } = /** @type {any} */ (window);
				if (shown && googletag) {
					googletag.cmd.push(() => googletag.pubads().refresh());
				}
			};

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
				'Unable to get 2D context for the minimap. This is probably your browser being dumb, maybe reload ' +
				'the page?',
			);

			return { canvas, ctx };
		})();

		ui.chat = (() => {
			const chat = {};

			const block = aux.require(
				document.querySelector('#chat_block'),
				'Can\'t find the chat UI. Try reloading the page?',
			);

			/**
			 * @param {ParentNode} root
			 * @param {string} selector
			 */
			function clone(root, selector) {
				/** @type {HTMLElement} */
				const old = aux.require(
					root.querySelector(selector),
					`Can't find this chat element: ${selector}. Try reloading the page?`,
				);

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
			input.style.position = 'fixed';
			toggle.style.position = 'fixed';
			scrollbar.style.position = 'fixed';

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

				if (toggled) {
					toggle.style.borderTopRightRadius = toggle.style.borderBottomRightRadius = '';
					toggle.style.opacity = '';
				} else {
					toggle.style.borderTopRightRadius = toggle.style.borderBottomRightRadius = '10px';
					toggle.style.opacity = '0.25';
				}
			});

			scrollbar.style.display = 'block';
			let scrollTop = 0; // keep a float here, because list.scrollTop is always casted to an int
			let thumbHeight = 1;
			let lastY;
			thumb.style.height = '182px';

			function updateThumb() {
				thumb.style.bottom = (1 - list.scrollTop / (list.scrollHeight - 182)) * (182 - thumbHeight) + 'px';
			}

			function scroll() {
				if (scrollTop >= list.scrollHeight - 182 - 40) {
					// close to bottom, snap downwards
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
				e.preventDefault();

				if (lastY === undefined) {
					lastY = e.clientY;
					return;
				}

				list.scrollTop = scrollTop = Math.min(Math.max(
					scrollTop + deltaY * list.scrollHeight / 182, 0), list.scrollHeight - 182);
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
				msg.textContent = aux.trim(text);
				container.appendChild(msg);

				while (list.children.length > 100)
					list.firstChild?.remove();

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
			};

			return chat;
		})();

		/** @param {string} msg */
		ui.error = msg => {
			const modal = /** @type {HTMLElement | null} */ (document.querySelector('#errormodal'));
			const desc = document.querySelector('#errormodal p');
			if (desc)
				desc.innerHTML = msg;

			if (modal)
				modal.style.display = 'block';
		};

		// sigmod quick fix
		(() => {
			// the play timer is inserted below the top-left stats, but because we offset them, we need to offset this
			// too
			const style = document.createElement('style');
			style.textContent = '.playTimer { transform: translate(5px, 10px); }';
			document.head.appendChild(style);
		})();

		return ui;
	})();



	/////////////////////////
	// Create Options Menu //
	/////////////////////////
	const settings = (() => {
		const settings = {
			/** @type {'auto' | 'never'} */
			autoZoom: 'auto',
			background: '',
			blockBrowserKeybinds: false,
			blockNearbyRespawns: false,
			boldUi: false,
			cellGlow: false,
			cellOpacity: 1,
			cellOutlines: true,
			clans: false,
			clanScaleFactor: 1,
			drawDelay: 120,
			jellySkinLag: true,
			massBold: false,
			massOpacity: 1,
			massScaleFactor: 1,
			mergeCamera: false,
			mergeViewArea: false,
			nameBold: false,
			nameScaleFactor: 1,
			outlineMulti: 0.2,
			// delta's default colors, #ff00aa and #ffffff
			outlineMultiColor: /** @type {[number, number, number, number]} */ ([1, 0, 2/3, 1]),
			outlineMultiInactiveColor: /** @type {[number, number, number, number]} */ ([1, 1, 1, 1]),
			pelletGlow: false,
			scrollFactor: 1,
			selfSkin: '',
			showOwnName: true,
			showStats: true,
			syncSkin: true,
			textOutlinesFactor: 1,
			tracer: false,
			unsplittableOpacity: 1,
		};

		try {
			Object.assign(settings, JSON.parse(localStorage.getItem('sigfix') ?? ''));
		} catch (_) { }

		/** @type {Set<() => void>} */
		const onSaves = new Set();

		const channel = new BroadcastChannel('sigfix-settings');
		channel.addEventListener('message', msg => {
			Object.assign(settings, msg.data);
			onSaves.forEach(fn => fn());
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

		function save() {
			localStorage.setItem('sigfix', JSON.stringify(settings));
			/** @type {any} */
			const replicated = { ...settings };
			delete replicated.selfSkin;
			channel.postMessage(replicated);
		}

		/**
		 * @template O, T
		 * @typedef {{ [K in keyof O]: O[K] extends T ? K : never }[keyof O]} PropertyOfType
		 */

		const vanillaMenu = document.querySelector('#cm_modal__settings .ctrl-modal__content');
		vanillaMenu?.appendChild(fromHTML(`
			<div class="menu__item">
				<div style="width: 100%; height: 1px; background: #bfbfbf;"></div>
			</div>
		`));

		const vanillaContainer = document.createElement('div');
		vanillaContainer.className = 'menu__item';
		vanillaMenu?.appendChild(vanillaContainer);

		const sigmodContainer = document.createElement('div');
		sigmodContainer.className = 'mod_tab scroll';
		sigmodContainer.style.display = 'none';

		/**
		 * @param {PropertyOfType<typeof settings, number>} property
		 * @param {string} title
		 * @param {number | undefined} initial
		 * @param {number} min
		 * @param {number} max
		 * @param {number} step
		 * @param {number} decimals
		 * @param {boolean} double
		 * @param {string} help
		 */
		function slider(property, title, initial, min, max, step, decimals, double, help) {
			/**
			 * @param {HTMLInputElement} slider
			 * @param {HTMLInputElement} display
			 */
			const listen = (slider, display) => {
				slider.value = settings[property].toString();
				display.value = settings[property].toFixed(decimals);

				slider.addEventListener('input', () => {
					settings[property] = Number(slider.value);
					display.value = settings[property].toFixed(decimals);
					save();
				});

				display.addEventListener('change', () => {
					const value = Number(display.value);
					if (!Number.isNaN(value))
						settings[property] = value;

					display.value = slider.value = settings[property].toFixed(decimals);
					save();
				});

				onSaves.add(() => {
					slider.value = settings[property].toString();
					display.value = settings[property].toFixed(decimals);
				});
			};

			const datalist = `<datalist id="sf-${property}-markers"> <option value="${initial}"></option> </datalist>`;
			const vanilla = fromHTML(`
				<div style="height: ${double ? '50' : '25'}px; position: relative;" title="${help}">
					<div style="height: 25px; line-height: 25px; position: absolute; top: 0; left: 0;">${title}</div>
					<div style="height: 25px; margin-left: 5px; position: absolute; right: 0; bottom: 0;">
						<input id="sf-${property}" style="display: block; float: left; height: 25px; line-height: 25px;\
							margin-left: 5px;" min="${min}" max="${max}" step="${step}" value="${initial}"
							list="sf-${property}-markers" type="range" />
						${initial !== undefined ? datalist : ''}
						<input id="sf-${property}-display" style="display: block; float: left; height: 25px; \
							line-height: 25px; width: 50px; text-align: right;" />
					</div>
				</div>
			`);
			listen(
				/** @type {HTMLInputElement} */(vanilla.querySelector(`input#sf-${property}`)),
				/** @type {HTMLInputElement} */(vanilla.querySelector(`input#sf-${property}-display`)));
			vanillaContainer.appendChild(vanilla);

			const datalistSm
				= `<datalist id="sfsm-${property}-markers"> <option value="${initial}"></option> </datalist>`;
			const sigmod = fromHTML(`
				<div class="modRowItems justify-sb" style="padding: 5px 10px;" title="${help}">
					<span>${title}</span>
					<span class="justify-sb">
						<input id="sfsm-${property}" style="width: 200px;" type="range" min="${min}" max="${max}"
							step="${step}" value="${initial}" list="sfsm-${property}-markers" />
						${initial !== undefined ? datalistSm : ''}
						<input id="sfsm-${property}-display" class="text-center form-control" style="border: none; \
							width: 50px; margin: 0 15px;" />
					</span>
				</div>
			`);
			listen(
				/** @type {HTMLInputElement} */(sigmod.querySelector(`input#sfsm-${property}`)),
				/** @type {HTMLInputElement} */(sigmod.querySelector(`input#sfsm-${property}-display`)));
			sigmodContainer.appendChild(sigmod);
		}

		/**
		 * @param {PropertyOfType<typeof settings, string>} property
		 * @param {string} title
		 * @param {string} placeholder
		 * @param {boolean} sync
		 * @param {string} help
		 */
		function input(property, title, placeholder, sync, help) {
			/**
			 * @param {HTMLInputElement} input
			 */
			const listen = input => {
				let oldValue = input.value = settings[property];

				input.addEventListener('input', () => {
					oldValue = settings[property] = /** @type {any} */ (input.value);
					save();
				});

				onSaves.add(() => {
					if (sync) input.value = settings[property];
					else input.value = settings[property] = /** @type {any} */ (oldValue);
				});
			};

			const vanilla = fromHTML(`
				<div style="height: 50px; position: relative;" title="${help}">
					<div style="height: 25px; line-height: 25px; position: absolute; top: 0; left: 0;">${title}</div>
					<div style="height: 25px; margin-left: 5px; position: absolute; right: 0; bottom: 0;">
						<input id="sf-${property}" placeholder="${placeholder}" type="text" />
					</div>
				</div>
			`);
			listen(/** @type {HTMLInputElement} */(vanilla.querySelector(`input#sf-${property}`)));
			vanillaContainer.appendChild(vanilla);

			const sigmod = fromHTML(`
				<div class="modRowItems justify-sb" style="padding: 5px 10px;" title="${help}">
					<span>${title}</span>
					<input class="modInput" id="sfsm-${property}" placeholder="${placeholder}" \
						style="width: 250px;" type="text" />
				</div>
			`);
			listen(/** @type {HTMLInputElement} */(sigmod.querySelector(`input#sfsm-${property}`)));
			sigmodContainer.appendChild(sigmod);
		}

		/**
		 * @param {PropertyOfType<typeof settings, boolean>} property
		 * @param {string} title
		 * @param {string} help
		 */
		function checkbox(property, title, help) {
			/**
			 * @param {HTMLInputElement} input
			 */
			const listen = input => {
				input.checked = settings[property];

				input.addEventListener('input', () => {
					settings[property] = input.checked;
					save();
				});

				onSaves.add(() => input.checked = settings[property]);
			};

			const vanilla = fromHTML(`
				<div style="height: 25px; position: relative;" title="${help}">
					<div style="height: 25px; line-height: 25px; position: absolute; top: 0; left: 0;">${title}</div>
					<div style="height: 25px; margin-left: 5px; position: absolute; right: 0; bottom: 0;">
						<input id="sf-${property}" type="checkbox" />
					</div>
				</div>
			`);
			listen(/** @type {HTMLInputElement} */(vanilla.querySelector(`input#sf-${property}`)));
			vanillaContainer.appendChild(vanilla);

			const sigmod = fromHTML(`
				<div class="modRowItems justify-sb" style="padding: 5px 10px;" title="${help}">
					<span>${title}</span>
					<div style="width: 75px; text-align: center;">
						<div class="modCheckbox" style="display: inline-block;">
							<input id="sfsm-${property}" type="checkbox" />
							<label class="cbx" for="sfsm-${property}"></label>
						</div>
					</div>
				</div>
			`);
			listen(/** @type {HTMLInputElement} */(sigmod.querySelector(`input#sfsm-${property}`)));
			sigmodContainer.appendChild(sigmod);
		}

		/**
		 * @param {PropertyOfType<typeof settings, [number, number, number, number]>} property
		 * @param {string} title
		 * @param {string} help
		 */
		function color(property, title, help) {
			/**
			 * @param {HTMLInputElement} input
			 * @param {HTMLInputElement} visible
			 */
			const listen = (input, visible) => {
				input.value = aux.rgba2hex6(...settings[property]);
				visible.checked = settings[property][3] > 0;

				const changed = () => {
					settings[property] = aux.hex2rgba(input.value);
					settings[property][3] = visible.checked ? 1 : 0;
					save();
				};
				input.addEventListener('input', changed);
				visible.addEventListener('input', changed);

				onSaves.add(() => {
					input.value = aux.rgba2hex6(...settings[property]);
					visible.checked = settings[property][3] > 0;
				});
			};

			const vanilla = fromHTML(`
				<div style="height: 25px; position: relative;" title="${help}">
					<div style="height: 25px; line-height: 25px; position: absolute; top: 0; left: 0;">${title}</div>
					<div style="height: 25px; margin-left: 5px; position: absolute; right: 0; bottom: 0;">
						<input id="sf-${property}-visible" type="checkbox" />
						<input id="sf-${property}" type="color" />
					</div>
				</div>
			`);
			listen(/** @type {HTMLInputElement} */(vanilla.querySelector(`input#sf-${property}`)),
				/** @type {HTMLInputElement} */(vanilla.querySelector(`input#sf-${property}-visible`)));
			vanillaContainer.appendChild(vanilla);

			const sigmod = fromHTML(`
				<div class="modRowItems justify-sb" style="padding: 5px 10px;" title="${help}">
					<span>${title}</span>
					<div style="width: 75px; text-align: center;">
						<div class="modCheckbox" style="display: inline-block;">
							<input id="sfsm-${property}-visible" type="checkbox" />
							<label class="cbx" for="sfsm-${property}-visible"></label>
						</div>
						<input id="sfsm-${property}" type="color" />
					</div>
				</div>
			`);
			listen(/** @type {HTMLInputElement} */(sigmod.querySelector(`input#sfsm-${property}`)),
				/** @type {HTMLInputElement} */(sigmod.querySelector(`input#sfsm-${property}-visible`)));
			sigmodContainer.appendChild(sigmod);
		}

		/**
		 * @param {PropertyOfType<typeof settings, string>} property
		 * @param {string} title
		 * @param {[string, string][]} options
		 * @param {string} help
		 */
		function dropdown(property, title, options, help) {
			/**
			 * @param {HTMLSelectElement} input
			 */
			const listen = input => {
				input.value = settings[property];

				const changed = () => {
					settings[property] = /** @type {any} */ (input.value);
					save();
				};
				input.addEventListener('input', changed);

				onSaves.add(() => {
					input.value = settings[property];
				});
			};

			const vanilla = fromHTML(`
				<div style="height: 25px; position: relative;" title="${help}">
					<div style="height: 25px; line-height: 25px; position: absolute; top: 0; left: 0;">${title}</div>
					<div style="height: 25px; margin-left: 5px; position: absolute; right: 0; bottom: 0;">
						<select id="sf-${property}">
							${options.map(([value, name]) => `<option value="${value}">${name}</option>`).join('\n')}
						</select>
					</div>
				</div>
			`);
			listen(/** @type {HTMLSelectElement} */(vanilla.querySelector(`select#sf-${property}`)));
			vanillaContainer.appendChild(vanilla);

			const sigmod = fromHTML(`
				<div class="modRowItems justify-sb" style="padding: 5px 10px;" title="${help}">
					<span>${title}</span>
					<select class="form-control" id="sfsm-${property}" style="width: 250px;">
						${options.map(([value, name]) => `<option value="${value}">${name}</option>`).join('\n')}
					</select>
				</div>
			`);
			listen(/** @type {HTMLSelectElement} */(sigmod.querySelector(`select#sfsm-${property}`)));
			sigmodContainer.appendChild(sigmod);
		}

		function separator(text = '•') {
			vanillaContainer.appendChild(fromHTML(`<div style="text-align: center; width: 100%;">${text}</div>`));
			sigmodContainer.appendChild(fromHTML(`<span class="text-center">${text}</span>`));
		}

		// #2 : generate ui for settings
		separator('Hover over a setting for more info');
		slider('drawDelay', 'Draw delay', 120, 40, 300, 1, 0, false,
			'How long (in ms) cells will lag behind for. Lower values mean cells will very quickly catch up to where ' +
			'they actually are.');
		checkbox('cellOutlines', 'Cell outlines', 'Whether the subtle dark outlines around cells (including skins) ' +
			'should draw.');
		slider('cellOpacity', 'Cell opacity', undefined, 0.5, 1, 0.005, 3, false,
			'How opaque cells should be. 1 = fully visible, 0 = invisible. It can be helpful to see the size of a ' +
			'smaller cell under a big cell.');
		input('selfSkin', 'Self skin URL (not synced)', 'https://i.imgur.com/...', false,
			'Direct URL to a custom skin for yourself. Not visible to others. You are able to use different skins ' +
			'for different tabs.');
		input('background', 'Map background image', 'https://i.imgur.com/...', true,
			'A square background image to use within the entire map border. Images under 1024x1024 will be treated ' +
			'as a repeating pattern, where 50 pixels = 1 grid square.');
		checkbox('tracer', 'Lines between cells and mouse', 'If enabled, draws a line between all of the cells you ' +
			'control and your mouse. Useful as a hint to your subconscious about which tab you\'re currently on.');
		separator('• multibox •');
		checkbox('mergeCamera', 'Merge camera between tabs',
			'Whether to place the camera in between your nearby tabs. This makes tab changes while multiboxing ' +
			'completely seamless (a sort of \'one-tab\'). This setting uses a weighted camera, which focuses the ' +
			'camera at your center of mass (i.e. your tiny cells won\'t mess up your aim).');
		checkbox('mergeViewArea', 'Combine visible cells between tabs',
			'When enabled, *all* tabs will share what cells they see between each other. Sigmally Fixes puts a lot ' +
			'of effort into making this as seamless as possible, so it can be laggy on lower-end devices.');
		slider('outlineMulti', 'Current tab cell outline thickness', 0.2, 0, 1, 0.01, 2, true,
			'Draws an inverse outline on your cells, the thickness being a % of your cell radius. This only shows ' +
			'when \'merge camera between tabs\' is enabled and when you\'re near one of your tabs.');
		color('outlineMultiColor', 'Current tab outline color',
			'The outline color of your current multibox tab.');
		color('outlineMultiInactiveColor', 'Other tab outline color',
			'The outline color for the cells of your other unfocused multibox tabs. Turn off the checkbox to disable.');
		separator('• inputs •');
		slider('scrollFactor', 'Zoom speed', 1, 0.05, 1, 0.05, 2, false,
			'A smaller zoom speed lets you fine-tune your zoom.');
		dropdown('autoZoom', 'Auto-zoom', [['auto', 'When not multiboxing'], ['never', 'Never']],
			'When enabled, automatically zooms in/out for you based on how big you are. ');
		checkbox('blockBrowserKeybinds', 'Block all browser keybinds',
			'When enabled, only Ctrl+Tab and F11 are allowed to be pressed. You must be in fullscreen, and ' +
			'non-Chrome browsers probably won\'t respect this setting. Doesn\'t work for Ctrl+W anymore: get a ' +
			'browser extension to block it for you.');
		checkbox('blockNearbyRespawns', 'Block respawns near other tabs',
			'Disables the respawn keybind (SigMod-only) when near one of your bigger tabs.');
		separator('• text •');
		slider('nameScaleFactor', 'Name scale factor', 1, 0.5, 2, 0.01, 2, false, 'The size multiplier of names.');
		slider('massScaleFactor', 'Mass scale factor', 1, 0.5, 4, 0.01, 2, false,
			'The size multiplier of mass (which is half the size of names)');
		slider('massOpacity', 'Mass opacity', 1, 0, 1, 0.01, 2, false,
			'The opacity of the mass text. You might find it visually appealing to have mass be a little dimmer than ' +
			'names.');
		checkbox('nameBold', 'Bold name text', 'Uses the bold Ubuntu font for names (like Agar.io).');
		checkbox('massBold', 'Bold mass text', 'Uses a bold font for mass.');
		checkbox('clans', 'Show clans', 'When enabled, shows the name of the clan a player is in above their name. ' +
			'If you turn off names (using SigMod), then player names will be replaced with their clan\'s.');
		slider('clanScaleFactor', 'Clan scale factor', 1, 0.5, 4, 0.01, 2, false,
			'The size multiplier of a player\'s clan displayed above their name (only when \'Show clans\' is ' +
			'enabled). When names are off, names will be replaced with clans and use the name scale factor instead.');
		slider('textOutlinesFactor', 'Text outline thickness factor', 1, 0, 2, 0.01, 2, false,
			'The multiplier of the thickness of the black stroke around names, mass, and clans on cells. You can set ' +
			'this to 0 to disable outlines AND text shadows.');
		checkbox('showOwnName', 'Show own name', 'When disabled, your name and clan won\'t be shown on your cells ' +
			'and your multibox tabs.');
		separator('• other •');
		slider('unsplittableOpacity', 'Unsplittable cell outline opacity', 1, 0, 1, 0.01, 2, true,
			'How visible the white outline around cells that can\'t split should be. 0 = not visible, 1 = fully ' +
			'visible.');
		checkbox('jellySkinLag', 'Jelly physics cell size lag',
			'Jelly physics causes cells to grow and shrink slower than text and skins, making the game more ' +
			'satisfying. If you have a skin that looks weird only with jelly physics, try turning this off.');
		checkbox('cellGlow', 'Cell glow', 'When enabled, makes cells have a slight glow. This could slightly ' +
			'affect performance.');
		checkbox('pelletGlow', 'Pellet glow', 'When enabled, gives pellets a slight glow. This should not affect ' +
			'performance.');
		checkbox('boldUi', 'Top UI uses bold text', 'When enabled, the top-left score and stats UI and the ' +
			'leaderboard will use the bold Ubuntu font.');
		checkbox('showStats', 'Show server stats', 'When disabled, hides the top-left server stats including the ' +
			'player count and server uptime.');
		checkbox('syncSkin', 'Show self skin on other tabs',
			'Whether your custom skin should be shown on your other tabs too.');

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



	////////////////////////////////
	// Setup Multi-tab World Sync //
	////////////////////////////////
	/** @typedef {{
	 * 	self: string,
	 * 	camera: { tx: number, ty: number },
	 * 	owned: Map<number, { x: number, y: number, r: number, jr: number } | false>,
	 * 	skin: string,
	 * 	updated: { now: number, timeOrigin: number },
	 * }} TabData
	 */
	const sync = (() => {
		const sync = {};
		/** @type {Map<string, number>} */
		sync.lastPacket = new Map();
		/** @type {{
		 * 	cells: Map<number, { merged: Cell | undefined, model: Cell | undefined, tabs: Map<string, Cell> }>,
		 * 	pellets: Map<number, { merged: Cell | undefined, model: Cell | undefined, tabs: Map<string, Cell> }>,
		 * } | undefined} */
		sync.merge = undefined;
		/** @type {Map<string, TabData>} */
		sync.others = new Map();

		const frame = new BroadcastChannel('sigfix-frame');
		const tabsync = new BroadcastChannel('sigfix-tabsync');
		const worldsync = new BroadcastChannel('sigfix-worldsync');
		const zoom = new BroadcastChannel('sigfix-zoom');
		const self = sync.self = Date.now() + '-' + Math.random();

		/**
		 * @param {TabData} data
		 * @param {number} foreignNow
		 */
		const localized = (data, foreignNow) => (data.updated.timeOrigin - performance.timeOrigin) + foreignNow;
		// foreignNow + data.updated.timeOrigin - performance.timeOrigin; different order so maybe better precision?

		sync.frame = () => {
			frame.postMessage(undefined);
		};
		frame.addEventListener('message', () => {
			// only update the world if we aren't rendering ourselves (example case: games open on two monitors)
			if (document.visibilityState === 'hidden') {
				world.moveCamera();
				input.move();
			}

			// might be preferable over document.visibilityState
			if (!document.hasFocus())
				input.antiAfk();
		});

		/** @param {number} now */
		sync.tabsync = now => {
			/** @type {TabData['owned']} */
			const owned = new Map();
			for (const id of world.mine) {
				const cell = world.cells.get(id);
				if (!cell) continue;

				owned.set(id, world.xyr(cell, undefined, now));
			}
			for (const id of world.mineDead)
				owned.set(id, false);

			/** @type {TabData} */
			const syncData = {
				self,
				camera: world.camera,
				owned,
				skin: settings.selfSkin,
				updated: { now, timeOrigin: performance.timeOrigin },
			};
			tabsync.postMessage(syncData);
		};
		tabsync.addEventListener('message', e => {
			/** @type {TabData} */
			const data = e.data;
			sync.others.set(data.self, data);
		});

		sync.worldsync = () => {
			worldsync.postMessage({ type: 'sync-response', cells: world.cells, pellets: world.pellets, self });
		};
		/** @param {DataView} dat */
		sync.worldupdate = dat => {
			worldsync.postMessage({ type: 'update', self, dat });
		};
		let lastSyncResponse = 0;
		worldsync.addEventListener('message', e => {
			switch (e.data.type) {
			case 'update': {
				/** @type {{ self: string, dat: DataView }} */
				const data = e.data;
				const now = performance.now();
				if (now - (sync.lastPacket.get(data.self) ?? -Infinity) > 3000) {
					// if we don't exactly know what data to build from, request it
					// there's a chance other tabs might not know either
					console.log('worldsyncRequesting', data.self);
					worldsync.postMessage({ type: 'sync-request', self: data.self });
					return;
				}

				sync.lastPacket.set(data.self, now);
				sync.readWorldUpdate(data.self, data.dat);
				sync.tryMerge();
				break;
			}

			case 'sync-request': {
				if (self !== /** @type {string} */ (e.data.self)) return;
				// do NOT tolerate spamming worldsyncRequests. let the other tabs suffer for a second, rather than resending
				// like 50 times on a lag spike
				const now = performance.now();
				if (now - lastSyncResponse < 1000) return;
				lastSyncResponse = now;
				console.log('worldsyncRequest');

				sync.tabsync(now);
				sync.worldsync();
				break;
			}

			case 'sync-response': {
				/** @type {{ cells: Map<number, Cell>, pellets: Map<number, Cell>, self: string }} */
				const data = e.data;
				const tab = sync.others.get(data.self);
				if (!tab || !sync.merge) return;

				console.log('worldsync response', data.self);

				// first, clear all previously known cells
				for (const key of /** @type {const} */ (['cells', 'pellets'])) {
					for (const [id, collection] of sync.merge[key]) {
						collection.tabs.delete(data.self);
						if (collection.tabs.size === 0) sync.merge[key].delete(id);
					}
				}

				// then add new ones
				for (const key of /** @type {const} */ (['cells', 'pellets'])) {
					for (const cell of data[key].values()) {
						cell.born = localized(tab, cell.born);
						cell.updated = localized(tab, cell.updated);
						if (cell.deadAt !== undefined) cell.deadAt = localized(tab, cell.deadAt);

						let collection = sync.merge[key].get(cell.id);
						if (!collection) {
							collection = { merged: undefined, model: undefined, tabs: new Map() };
							sync.merge[key].set(cell.id, collection);
						}
						collection.tabs.set(data.self, cell);
					}
				}

				sync.lastPacket.set(data.self, performance.now());
				break;
			}
			}
		});

		sync.zoom = () => zoom.postMessage(input.zoom);
		zoom.addEventListener('message', e => void (input.zoom = e.data));

		/**
		 * @param {string} tab
		 * @param {DataView} dat
		 */
		sync.readWorldUpdate = (tab, dat) => {
			let off = 0;
			const now = performance.now();
			switch (dat.getUint8(off++)) {
				case 0x10: // world updates
					// #a : kills / consumes
					const killCount = dat.getUint16(off, true);
					off += 2;

					for (let i = 0; i < killCount; ++i) {
						const killerId = dat.getUint32(off, true);
						const killedId = dat.getUint32(off + 4, true);
						off += 8;

						let killed;
						if (tab === self) {
							killed = world.pellets.get(killedId) ?? world.cells.get(killedId);
						} else {
							killed = sync.merge?.pellets.get(killedId)?.tabs.get(tab)
								?? sync.merge?.cells.get(killedId)?.tabs.get(tab);
						}
						if (killed) {
							killed.deadTo = killerId;
							killed.deadAt = killed.updated = now;

							if (tab === self) {
								world.clanmates.delete(killed);

								if (killed.pellet && world.mine.includes(killerId))
									++world.stats.foodEaten;

								const myIdx = world.mine.indexOf(killedId);
								if (myIdx !== -1) {
									world.mine.splice(myIdx, 1);
									world.mineDead.add(killedId);
								}
							}
						}
					}

					// #b : updates
					while (true) {
						const id = dat.getUint32(off, true);
						off += 4;
						if (id === 0) break;

						const x = dat.getInt16(off, true);
						const y = dat.getInt16(off + 2, true);
						const r = dat.getUint16(off + 4, true);
						const flags = dat.getUint8(off + 6);
						// (void 1 byte, "isUpdate")
						// (void 1 byte, "isPlayer")
						const sub = !!dat.getUint8(off + 9);
						off += 10;

						let clan;
						[clan, off] = aux.readZTString(dat, off);

						/** @type {number | undefined} */
						let Rgb, rGb, rgB;
						if (flags & 0x02) {
							// update color
							Rgb = dat.getUint8(off) / 255;
							rGb = dat.getUint8(off + 1) / 255;
							rgB = dat.getUint8(off + 2) / 255;
							off += 3;
						}

						let skin = '';
						if (flags & 0x04) {
							// update skin
							[skin, off] = aux.readZTString(dat, off);
							skin = aux.parseSkin(skin);
						}

						let name = '';
						if (flags & 0x08) {
							// update name
							[name, off] = aux.readZTString(dat, off);
							name = aux.parseName(name);
							render.textFromCache(name, sub); // make sure the texture is ready on render
						}

						const jagged = !!(flags & 0x11);
						const eject = !!(flags & 0x20);

						/** @type {Cell | undefined} */
						let cell;
						if (tab === self) {
							// prefer accessing the local map
							cell = world.cells.get(id) ?? world.pellets.get(id);
						} else {
							cell = sync.merge?.cells.get(id)?.tabs.get(tab)
								?? sync.merge?.pellets.get(id)?.tabs.get(tab);
						}
						if (cell && cell.deadAt === undefined) {
							const { x: ix, y: iy, r: ir, jr } = world.xyr(cell, undefined, now);
							cell.ox = ix; cell.oy = iy; cell.or = ir;
							cell.jr = jr;
							cell.nx = x; cell.ny = y; cell.nr = r;
							cell.jagged = jagged;
							cell.updated = now;

							if (Rgb !== undefined) {
								cell.Rgb = Rgb;
								cell.rGb = /** @type {number} */ (rGb);
								cell.rgB = /** @type {number} */ (rgB);
							}
							if (skin) cell.skin = skin;
							if (name) cell.name = name;
							cell.sub = sub;

							cell.clan = clan;
							if (tab === self && clan && clan === aux.userData?.clan)
								world.clanmates.add(cell);
						} else {
							if (cell?.deadAt !== undefined) {
								// when respawning, OgarII does not send the description of cells if you spawn in the
								// same area, despite those cells being deleted from your view area
								if (Rgb === undefined)
									({ Rgb, rGb, rgB } = cell);
								name ??= cell.name;
								skin ??= cell.skin;
							}

							/** @type {Cell} */
							const ncell = {
								id,
								ox: x, nx: x,
								oy: y, ny: y,
								or: r, nr: r, jr: r,
								Rgb: Rgb ?? 1, rGb: rGb ?? 1, rgB: rgB ?? 1,
								jagged, pellet: r < 75 && !eject, // tourney servers have bigger pellets
								updated: now, born: now,
								deadAt: undefined, deadTo: -1,
								name, skin, sub, clan,
							};

							const key = ncell.pellet ? 'pellets' : 'cells';
							if (tab === self) world[key].set(id, ncell);
							if (sync.merge) {
								let collection = sync.merge[key].get(id);
								if (!collection) {
									collection = { merged: undefined, model: undefined, tabs: new Map() };
									sync.merge[key].set(id, collection);
								}
								collection.tabs.set(tab, ncell);
							}

							if (tab === self && clan === aux.userData?.clan)
								world.clanmates.add(ncell);
						}
					}

					// #c : deletes
					const deleteCount = dat.getUint16(off, true);
					off += 2;

					for (let i = 0; i < deleteCount; ++i) {
						const deletedId = dat.getUint32(off, true);
						off += 4;

						let deleted;
						if (tab === self) {
							deleted = world.pellets.get(deletedId) ?? world.cells.get(deletedId);
						} else {
							deleted = sync.merge?.pellets.get(deletedId)?.tabs.get(tab)
								?? sync.merge?.cells.get(deletedId)?.tabs.get(tab);
						}
						if (deleted) {
							if (deleted.deadAt === undefined) {
								deleted.deadAt = now;
								deleted.deadTo = -1;
							}

							if (tab === self) {
								world.clanmates.delete(deleted);

								const myIdx = world.mine.indexOf(deletedId);
								if (myIdx !== -1) {
									world.mine.splice(myIdx, 1);
									world.mineDead.add(myIdx);
								}
							}
						}
					}

					// #4 : clean all cells
					sync.clean();
					if (tab === self) {
						for (const [id, cell] of world.cells) {
							if (cell.deadAt === undefined) continue;
							if (now - cell.deadAt >= 200) {
								world.cells.delete(id);
								world.mineDead.delete(id);
							}
						}

						for (const [id, cell] of world.pellets) {
							if (cell.deadAt === undefined) continue;
							if (now - cell.deadAt >= 200) {
								world.pellets.delete(id);
							}
						}
					}
					break;

				case 0x12: // delete all cells
					console.log('delete all cells:', tab, tab === self);
					if (tab === self) {
						world.cells.clear();
						world.pellets.clear();
					}

					if (sync.merge) {
						for (const [id, collection] of sync.merge.cells) {
							collection.tabs.delete(tab);
							if (collection.tabs.size === 0) sync.merge.cells.delete(id);
						}

						for (const [id, collection] of sync.merge.pellets) {
							collection.tabs.delete(tab);
							if (collection.tabs.size === 0) sync.merge.pellets.delete(id);
						}
					}
					break;
			}
		};

		sync.tryMerge = () => {
			// for camera merging to look extremely smooth, we need to merge packets and apply them *ONLY* when all
			// tabs are synchronized.
			// if you simply fall back to what the other tabs see, you will get lots of flickering and warping (what
			// delta suffers from).
			// threfore, we make sure that all tabs that share visible cells see them in the same spots, to make sure
			// they are all on the same tick
			// it's also not sufficient to simply count how many update (0x10) packets we get, as /leaveworld (part of
			// respawn functionality) stops those packets from coming in
			// if the view areas are disjoint, then there's nothing we can do but this should never happen when
			// splitrunning

			if (!settings.mergeViewArea || performance.now() - render.lastFrame > 45_000 || sync.others.size === 0) {
				// very performance-intensive; don't update if not rendering
				sync.merge = undefined;
				render.upload('pellets');
				return;
			}

			const now = performance.now();
			let inheritBorn = false; // without, when turning on sync.merge, cells will appear to fade in again

			if (!sync.merge) {
				sync.merge = { cells: new Map(), pellets: new Map() };
				inheritBorn = true;

				// copy all local cells into here
				for (const [map, to]
					of /** @type {const} */ ([[world.cells, sync.merge.cells], [world.pellets, sync.merge.pellets]])) {
					for (const [id, cell] of map) {
						/** @type {Map<string, Cell>} */
						const tabs = new Map();
						tabs.set(self, cell);
						to.set(id, { merged: undefined, model: undefined, tabs });
					}
				}
			}

			// #2 : ensure all important cells are synced
			for (const map of [sync.merge.cells, sync.merge.pellets]) {
				for (const collection of map.values()) {
					/** @type {Cell | undefined} */
					let model;
					for (const cell of collection.tabs.values()) {
						if (!model) {
							model = cell;
							continue;
						}

						const modelDisappeared = model.deadAt !== undefined && model.deadTo === -1;
						const cellDisappeared = cell.deadAt !== undefined && cell.deadTo === -1;

						if (!modelDisappeared && !cellDisappeared) {
							// both cells are visible; are they going to the same place?
							if (model.nx !== cell.nx || model.ny !== cell.ny || model.nr !== cell.nr) {
								return; // outta here
							}
						} else if (modelDisappeared && !cellDisappeared) {
							// model went out of view; prefer the visible cell
							model = cell;
						} else if (!modelDisappeared && cellDisappeared) {
							// cell went out of view; prefer model
						} else {
							// both cells went out of view; prefer the one that disappeared latest
							if (/** @type {number} */ (cell.deadAt) > /** @type {number} */ (model.deadAt)) {
								model = cell;
							}
						}
					}

					collection.model = model;
				}
			}

			// #3 : tabs are all synced; merge changes
			for (const map of [sync.merge.cells, sync.merge.pellets]) {
				for (const [id, collection] of map) {
					const merged = collection.merged;
					const model = collection.model;
					if (!model) {
						collection.merged = undefined;
						continue;
					}

					if (!merged) {
						if (model.deadAt === undefined) {
							collection.merged = {
								id,
								ox: model.nx, nx: model.nx,
								oy: model.ny, ny: model.ny,
								or: model.nr, nr: model.nr, jr: model.nr,
								Rgb: model.Rgb, rGb: model.rGb, rgB: model.rgB,
								jagged: model.jagged, pellet: model.pellet,
								name: model.name, skin: model.skin, sub: model.sub, clan: model.clan,
								born: inheritBorn ? model.born : now, updated: now,
								deadTo: -1,
								deadAt: undefined,
							};
						}
					} else {
						if (merged.deadAt === undefined) {
							const { x, y, r, jr } = world.xyr(merged, undefined, now);
							merged.ox = x;
							merged.oy = y;
							merged.or = r;
							merged.jr = jr;
							merged.nx = model.nx;
							merged.ny = model.ny;
							merged.nr = model.nr;
							merged.updated = now;
						}

						if (model.deadAt !== undefined) {
							if (merged.deadAt === undefined) {
								// merged is finally dying
								merged.deadAt = now;
								merged.deadTo = model.deadTo;
							}
						} else if (merged.deadAt !== undefined) {
							// cell is no longer dead (probably came back into view)
							merged.ox = model.nx;
							merged.oy = model.ny;
							merged.or = model.nr;
							merged.deadAt = undefined;
							merged.deadTo = -1;
							merged.born = merged.updated = now;
						}
					}
				}
			}

			sync.clean();
			render.upload('pellets');
		};

		let lastClean = 0;
		sync.clean = () => {
			const now = performance.now();
			if (now - lastClean < 500) return; // sync.clean is a huge bottleneck
			lastClean = now;

			if (sync.merge) {
				// don't do array unpacking if not necessary
				let idIterator = sync.merge.cells.keys();
				for (const collection of sync.merge.cells.values()) {
					const id = idIterator.next().value;
					const cellIterator = collection.tabs.values();

					for (const key of collection.tabs.keys()) {
						if (key === self || sync.others.has(key)) {
							const cell = /** @type {Cell} */ (cellIterator.next().value);
							if (cell.deadAt === undefined) continue;
							if (now - cell.deadAt < 500) continue;
						}

						collection.tabs.delete(key);
						if (key === self) world.mineDead.delete(id);
					}

					if (collection.tabs.size === 0) sync.merge.cells.delete(id);
				}

				idIterator = sync.merge.pellets.keys();
				for (const collection of sync.merge.pellets.values()) {
					const id = idIterator.next().value;
					const cellIterator = collection.tabs.values();

					for (const key of collection.tabs.keys()) {
						if (key === self || sync.others.has(key)) {
							const cell = cellIterator.next().value;
							if (cell.deadAt === undefined) continue;
							if (now - cell.deadAt < 500) continue;
						}

						collection.tabs.delete(key);
					}

					if (collection.tabs.size === 0) sync.merge.pellets.delete(id);
				}
			}

			sync.others.forEach((data, key) => {
				// only get rid of a tab if it lags out alone
				if (net.lastUpdate - localized(data, data.updated.now) > 500) {
					sync.others.delete(key);
					sync.lastPacket.delete(key);
				}
			});
		};
		setInterval(() => sync.clean(), 250);

		return sync;
	})();



	///////////////////////////
	// Setup World Variables //
	///////////////////////////
	/** @typedef {{
	 * id: number,
	 * ox: number, nx: number,
	 * oy: number, ny: number,
	 * or: number, nr: number, jr: number,
	 * Rgb: number, rGb: number, rgB: number,
	 * updated: number, born: number, deadTo: number, deadAt: number | undefined,
	 * jagged: boolean, pellet: boolean,
	 * name: string, skin: string, sub: boolean, clan: string,
	 * }} Cell */
	const world = (() => {
		const world = {};

		// #1 : define cell variables and functions
		/** @type {Map<number, Cell>} */
		world.cells = new Map();
		/** @type {Set<Cell>} */
		world.clanmates = new Set();
		/** @type {number[]} */
		world.mine = []; // order matters, as the oldest cells split first
		/** @type {Set<number>} */
		world.mineDead = new Set();
		/** @type {Map<number, Cell>} */
		world.pellets = new Map();

		/**
		 * @param {Cell} cell
		 * @param {Cell | undefined} killer
		 * @param {number} now
		 * @returns {{ x: number, y: number, r: number, jr: number }}
		 */
		world.xyr = (cell, killer, now) => {
			let a = (now - cell.updated) / settings.drawDelay;
			a = a < 0 ? 0 : a > 1 ? 1 : a;
			let nx = cell.nx;
			let ny = cell.ny;
			if (killer && cell.deadAt !== undefined && (killer.deadAt === undefined || cell.deadAt <= killer.deadAt)) {
				// do not animate death towards a cell that died already (went offscreen)
				nx = killer.nx;
				ny = killer.ny;
			}

			const x = cell.ox + (nx - cell.ox) * a;
			const y = cell.oy + (ny - cell.oy) * a;
			const r = cell.or + (cell.nr - cell.or) * a;

			const dt = (now - cell.updated) / 1000;
			return {
				x, y, r,
				jr: aux.exponentialEase(cell.jr, r, 5, dt), // vanilla uses a factor of 10, but it's basically unusable
			};
		};

		let last = performance.now();
		world.moveCamera = () => {
			const now = performance.now();
			const dt = (now - last) / 1000;
			last = now;

			const weight = settings.mergeCamera ? 2 : 0;

			/**
			 * @param {Iterable<number>} owned
			 * @param {Map<number, { x: number, y: number, r: number, jr: number } | false> | undefined} fallback
			 * @returns {{
			 * 	weightedX: number, weightedY: number, totalWeight: number,
			 * 	scale: number, width: number, height: number
			 * }}
			 */
			const cameraDesc = (owned, fallback) => {
				let weightedX = 0;
				let weightedY = 0;
				let totalWeight = 0;
				let totalR = 0;

				for (const id of owned) {
					/** @type {{ x: number, y: number, r: number, jr: number }} */
					let xyr;

					let cell;
					if (settings.mergeViewArea && sync.merge) {
						cell = sync.merge.cells.get(id)?.merged;
					} else {
						cell = world.cells.get(id);
					}
					if (!cell) {
						const partial = fallback?.get(id);
						if (!partial) continue;
						xyr = partial;
					} else if (cell.deadAt !== undefined) continue;
					else xyr = world.xyr(cell, undefined, now);

					const weighted = xyr.r ** weight;
					weightedX += xyr.x * weighted;
					weightedY += xyr.y * weighted;
					totalWeight += weighted;
					totalR += xyr.r;
				}

				const scale = Math.min(64 / totalR, 1) ** 0.4;
				const width = 1920 / 2 / scale;
				const height = 1080 / 2 / scale;

				return { weightedX, weightedY, totalWeight, scale, width, height };
			};

			const localDesc = cameraDesc(world.mine, undefined);
			let { weightedX, weightedY, totalWeight } = localDesc;
			const localX = weightedX / totalWeight;
			const localY = weightedY / totalWeight;

			world.camera.merged = false;
			if (settings.mergeCamera && localDesc.totalWeight > 0) {
				for (const data of sync.others.values()) {
					const thisDesc = cameraDesc(data.owned.keys(), data.owned);
					if (thisDesc.totalWeight <= 0) continue;
					const thisX = thisDesc.weightedX / thisDesc.totalWeight;
					const thisY = thisDesc.weightedY / thisDesc.totalWeight;

					const threshold = 1000
						+ Math.min(localDesc.totalWeight / 100 / 100, thisDesc.totalWeight / 100 / 100);
					if (Math.abs(thisX - localX) < localDesc.width + thisDesc.width + threshold
						&& Math.abs(thisY - localY) < localDesc.height + thisDesc.height + threshold) {
						weightedX += thisDesc.weightedX;
						weightedY += thisDesc.weightedY;
						totalWeight += thisDesc.totalWeight;
						world.camera.merged = true;
					}
				}
			}

			// auto + merge => 0.25
			// auto + -merge => localDesc.scale
			// never + merge => 0.25
			// never + -merge => 0.25
			/** @type {number} */
			let zoomout;
			if (settings.autoZoom === 'never' || (settings.autoZoom === 'auto' && settings.mergeCamera)) {
				zoomout = 0.25;
			} else {
				zoomout = localDesc.scale;
			}

			let xyEaseFactor;
			if (totalWeight > 0) {
				world.camera.tx = weightedX / totalWeight;
				world.camera.ty = weightedY / totalWeight;
				world.camera.tscale = zoomout * input.zoom;

				xyEaseFactor = 2;
			} else {
				xyEaseFactor = 20;
			}

			world.camera.x = aux.exponentialEase(world.camera.x, world.camera.tx, xyEaseFactor, dt);
			world.camera.y = aux.exponentialEase(world.camera.y, world.camera.ty, xyEaseFactor, dt);
			world.camera.scale = aux.exponentialEase(world.camera.scale, world.camera.tscale, 9, dt);
		};



		// #2 : define others, like camera and borders
		world.camera = {
			x: 0, y: 0, scale: 1,
			tx: 0, ty: 0, tscale: 1,
			merged: false,
		};

		/** @type {{ l: number, r: number, t: number, b: number } | undefined} */
		world.border = undefined;

		/** @type {{ name: string, me: boolean, sub: boolean, place: number | undefined }[]} */
		world.leaderboard = [];



		// #3 : define stats
		world.stats = {
			foodEaten: 0,
			highestPosition: 200,
			highestScore: 0,
			/** @type {number | undefined} */
			spawnedAt: undefined,
		};



		return world;
	})();



	//////////////////////////
	// Setup All Networking //
	//////////////////////////
	const net = (() => {
		const net = {};

		// #1 : define state
		/** @type {{ shuffle: Map<number, number>, unshuffle: Map<number, number> } | undefined} */
		let handshake;
		/** @type {number | undefined} */
		let pendingPingFrom;
		let pingInterval;
		let wasOpen = false;
		/** @type {WebSocket} */
		let ws;

		/** -1 if ping reply took too long @type {number | undefined} */
		net.latency = undefined;
		net.ready = false;
		net.lastUpdate = -Infinity;
		net.rejected = false;

		// #2 : connecting/reconnecting the websocket
		/** @type {HTMLSelectElement | null} */
		const gamemode = document.querySelector('#gamemode');
		/** @type {HTMLOptionElement | null} */
		const firstGamemode = document.querySelector('#gamemode option');

		net.url = () => {
			let server = 'wss://' + (gamemode?.value || firstGamemode?.value || 'ca0.sigmally.com/ws/');
			if (location.search.startsWith('?ip='))
				server = location.search.slice('?ip='.length);

			return server;
		};

		function connect() {
			// you can connect to multiple servers easily while being ratelimited
			if (ws?.readyState !== WebSocket.CLOSED && ws?.readyState !== WebSocket.CLOSING) ws?.close?.();
			try {
				ws = new destructor.realWebSocket(net.url());
			} catch (err) {
				console.error('can\'t make WebSocket:', err);
				aux.require(null, 'The server is invalid. Try changing the server, reloading the page, or clearing ' +
					'your browser cache and cookies.');
			}

			destructor.safeWebSockets.add(ws);
			ws.binaryType = 'arraybuffer';
			ws.addEventListener('close', wsClose);
			ws.addEventListener('error', wsError);
			ws.addEventListener('message', wsMessage);
			ws.addEventListener('open', wsOpen);
		}

		function wsClose() {
			handshake = undefined;
			pendingPingFrom = undefined;
			if (pingInterval)
				clearInterval(pingInterval);

			net.latency = undefined;
			net.lastUpdate = performance.now();
			net.ready = false;
			if (!wasOpen) net.rejected = true;
			wasOpen = false;

			// hide/clear UI and show death screen if necessary
			ui.stats.misc.textContent = '';
			world.leaderboard = [];
			ui.leaderboard.update();
			if (world.stats.spawnedAt !== undefined) {
				ui.deathScreen.show(world.stats);
				ui.stats.update();
			} else {
				ui.toggleEscOverlay(true);
			}

			// clear world
			world.border = undefined;
			world.cells.clear(); // make sure we won't see overlapping IDs from new cells from the new connection
			world.pellets.clear();
			world.clanmates.clear();
			while (world.mine.length) world.mine.pop();
			world.mineDead.clear();
			sync.tabsync(performance.now());
			sync.worldupdate(new DataView(new Uint8Array([ 0x12 ]).buffer)); // broadcast a "delete all cells" packet
			sync.tryMerge();
		}

		let reconnectAttempts = 0;
		/** @type {number | undefined} */
		let willReconnectAt;
		setInterval(() => {
			// retry after 500, 1000, 1500, 3000ms of closing
			// OR if a captcha was (very recently) accepted
			if (ws.readyState !== WebSocket.CLOSING && ws.readyState !== WebSocket.CLOSED)
				return;

			const now = performance.now();
			if (input.captchaAcceptedAt && now - input.captchaAcceptedAt <= 3000) {
				willReconnectAt = undefined;
				connect();
				return;
			}

			if (willReconnectAt === undefined) {
				willReconnectAt = now + Math.min(500 * ++reconnectAttempts, 3000);
			} else if (now >= willReconnectAt) {
				willReconnectAt = undefined;
				connect();
			}
		}, 50);

		/** @param {Event} err */
		function wsError(err) {
			console.error('WebSocket error:', err);
		}

		function wsOpen() {
			net.rejected = false;
			wasOpen = true;
			reconnectAttempts = 0;

			ui.chat.barrier();

			// reset camera location to the middle; this is implied but never sent by the server
			world.camera.x = world.camera.tx = 0;
			world.camera.y = world.camera.ty = 0;
			world.camera.scale = world.camera.tscale = 1;

			ws.send(aux.textEncoder.encode('SIG 0.0.1\x00'));
		}

		// listen for when the gamemode changes
		gamemode?.addEventListener('change', () => {
			ws.close();
		});



		// #3 : set up auxiliary functions
		/**
		 * @param {number} opcode
		 * @param {object} data
		 */
		function sendJson(opcode, data) {
			// must check readyState as a weboscket might be in the 'CLOSING' state (so annoying!)
			if (!handshake || ws.readyState !== WebSocket.OPEN) return;
			const dataBuf = aux.textEncoder.encode(JSON.stringify(data));
			const dat = new DataView(new ArrayBuffer(dataBuf.byteLength + 2));

			dat.setUint8(0, Number(handshake.shuffle.get(opcode)));
			for (let i = 0; i < dataBuf.byteLength; ++i) {
				dat.setUint8(1 + i, dataBuf[i]);
			}

			ws.send(dat);
		}

		function createPingLoop() {
			function ping() {
				if (!handshake || ws.readyState !== WebSocket.OPEN) return; // shouldn't ever happen

				if (pendingPingFrom !== undefined) {
					// ping was not replied to, tell the player the ping text might be wonky for a bit
					net.latency = -1;
				}

				ws.send(new Uint8Array([Number(handshake.shuffle.get(0xfe))]));
				pendingPingFrom = performance.now();
			}

			pingInterval = setInterval(ping, 2_000);
		}



		// #4 : set up message handler
		/** @param {MessageEvent} msg */
		function wsMessage(msg) {
			const dat = new DataView(msg.data);
			if (!handshake) {
				// unlikely to change as we're still on v0.0.1 but i'll check it anyway
				let [version, off] = aux.readZTString(dat, 0);
				if (version !== 'SIG 0.0.1') {
					alert(`got unsupported version "${version}", expected "SIG 0.0.1"`);
					return ws.close();
				}

				handshake = { shuffle: new Map(), unshuffle: new Map() };
				for (let i = 0; i < 256; ++i) {
					const shuffled = dat.getUint8(off + i);
					handshake.shuffle.set(i, shuffled);
					handshake.unshuffle.set(shuffled, i);
				}

				createPingLoop();

				return;
			}

			const now = performance.now();
			const opcode = Number(handshake.unshuffle.get(dat.getUint8(0)));
			dat.setUint8(0, opcode);
			let off = 1;
			switch (opcode) {
				case 0x10: { // world update
					net.lastUpdate = now;
					if (destructor.respawnBlock?.status === 'left') {
						destructor.respawnBlock = undefined;
					}

					// start ASAP!
					sync.tabsync(now);
					if (settings.mergeViewArea) sync.worldupdate(dat);

					sync.readWorldUpdate(sync.self, dat);
					sync.tryMerge();

					if (world.mine.length === 0 && world.stats.spawnedAt !== undefined) {
						ui.deathScreen.show(world.stats);
					}

					ui.stats.update();
					break;
				}

				case 0x11: { // update camera pos
					world.camera.tx = dat.getFloat32(off, true);
					world.camera.ty = dat.getFloat32(off + 4, true);
					world.camera.tscale = dat.getFloat32(off + 8, true) * input.zoom;
					break;
				}

				case 0x12: // delete all cells
					net.lastUpdate = now;
					// happens every time you respawn
					if (destructor.respawnBlock?.status === 'pending') {
						destructor.respawnBlock.status = 'left';
					}
					sync.readWorldUpdate(sync.self, dat);
					sync.tryMerge();
					world.clanmates.clear();
					if (settings.mergeViewArea) sync.worldupdate(dat);
				// passthrough
				case 0x14: // delete my cells
					while (world.mine.length) world.mine.pop();
					break;

				case 0x20: { // new owned cell
					world.mine.push(dat.getUint32(off, true));
					if (world.mine.length === 1)
						world.stats.spawnedAt = now;
					break;
				}

				// case 0x30 is a text list (not a numbered list), leave unsupported
				case 0x31: { // ffa leaderboard list
					const lb = [];
					const count = dat.getUint32(off, true);
					off += 4;

					let myPosition;
					for (let i = 0; i < count; ++i) {
						const me = !!dat.getUint32(off, true);
						off += 4;

						let name;
						[name, off] = aux.readZTString(dat, off);
						name = aux.parseName(name);

						// why this is copied into every leaderboard entry is beyond my understanding
						myPosition = dat.getUint32(off, true);
						const sub = !!dat.getUint32(off + 4, true);
						off += 8;

						lb.push({ name, sub, me, place: undefined });
					}

					if (myPosition) {
						if (myPosition - 1 >= lb.length) {
							/** @type {HTMLInputElement | null} */
							const inputName = document.querySelector('input#nick');
							lb.push({
								me: true,
								name: aux.parseName(inputName?.value ?? ''),
								place: myPosition,
								sub: false,
							});
						}

						if (myPosition < world.stats.highestPosition)
							world.stats.highestPosition = myPosition;
					}

					world.leaderboard = lb;
					ui.leaderboard.update();
					break;
				}

				case 0x40: { // border update
					world.border = {
						l: dat.getFloat64(off, true),
						t: dat.getFloat64(off + 8, true),
						r: dat.getFloat64(off + 16, true),
						b: dat.getFloat64(off + 24, true),
					};
					break;
				}

				case 0x63: { // chat message
					const flags = dat.getUint8(off);
					const rgb = /** @type {[number, number, number, number]} */
						([dat.getUint8(off + 1) / 255, dat.getUint8(off + 2) / 255, dat.getUint8(off + 3) / 255, 1]);
					off += 4;

					let name;
					[name, off] = aux.readZTString(dat, off);
					let msg;
					[msg, off] = aux.readZTString(dat, off);

					ui.chat.add(name, rgb, msg, !!(flags & 0x80));
					break;
				}

				case 0xb4: { // incorrect password alert
					ui.error('Password is incorrect');
					break;
				}

				case 0xdd: {
					net.howarewelosingmoney();
					net.ready = true;
					break;
				}

				case 0xfe: { // server stats, response to a ping
					let statString;
					[statString, off] = aux.readZTString(dat, off);

					const statData = JSON.parse(statString);
					ui.stats.updateMisc(statData);

					if (pendingPingFrom) {
						net.latency = now - pendingPingFrom;
						pendingPingFrom = undefined;
					}
					break;
				}
			}
		}



		// #5 : export input functions
		/**
		 * @param {number} x
		 * @param {number} y
		 */
		net.move = function (x, y) {
			if (!handshake || ws.readyState !== WebSocket.OPEN) return;
			const dat = new DataView(new ArrayBuffer(13));

			dat.setUint8(0, Number(handshake.shuffle.get(0x10)));
			dat.setInt32(1, x, true);
			dat.setInt32(5, y, true);

			ws.send(dat);
		};

		net.w = function () {
			if (!handshake || ws.readyState !== WebSocket.OPEN) return;
			ws.send(new Uint8Array([Number(handshake.shuffle.get(21))]));
		};

		net.qdown = function () {
			if (!handshake || ws.readyState !== WebSocket.OPEN) return;
			ws.send(new Uint8Array([Number(handshake.shuffle.get(18))]));
		};

		net.qup = function () {
			if (!handshake || ws.readyState !== WebSocket.OPEN) return;
			ws.send(new Uint8Array([Number(handshake.shuffle.get(19))]));
		};

		net.split = function () {
			if (!handshake || ws.readyState !== WebSocket.OPEN) return;
			ws.send(new Uint8Array([Number(handshake.shuffle.get(17))]));
		};

		/**
		 * @param {string} msg
		 */
		net.chat = function (msg) {
			if (!handshake || ws.readyState !== WebSocket.OPEN) return;
			const msgBuf = aux.textEncoder.encode(msg);
			const dat = new DataView(new ArrayBuffer(msgBuf.byteLength + 3));

			dat.setUint8(0, Number(handshake.shuffle.get(0x63)));
			// skip flags, not implemented anyway
			for (let i = 0; i < msgBuf.byteLength; ++i)
				dat.setUint8(2 + i, msgBuf[i]);

			ws.send(dat);
		};

		/**
		 * @param {{ name: string, skin: string, [x: string]: any }} data
		 */
		net.play = function (data) {
			sendJson(0x00, data);
		};

		net.howarewelosingmoney = function () {
			if (!handshake || ws.readyState !== WebSocket.OPEN) return;
			// this is a new thing added with the rest of the recent source code obfuscation (2024/02/18)
			// which collects and links to your sigmally account, seemingly just for light data analysis but probably
			// just for the fun of it:
			// - your IP and country
			// - whether you are under a proxy
			// - whether you are using sigmod (because it also blocks ads)
			// - whether you are using a traditional adblocker
			//
			// so, no thank you
			sendJson(0xd0, { ip: '', country: '', proxy: false, user: null, blocker: 'sigmally fixes @8y8x' });
		};

		net.connection = function () {
			if (!ws) return undefined;
			if (!handshake || ws.readyState !== WebSocket.OPEN) return undefined;
			return ws;
		};



		connect();
		return net;
	})();



	//////////////////////////
	// Setup Input Handlers //
	//////////////////////////
	const input = (() => {
		const input = {};

		// #1 : general inputs
		/** @type {number | undefined} */
		let lastMouseX = undefined;
		/** @type {number | undefined} */
		let lastMouseY = undefined;
		let mouseX = 0; // -1 <= mouseX <= 1
		let mouseY = 0; // -1 <= mouseY <= 1
		let forceW = false;
		let w = false;

		input.zoom = 1;

		/** @returns [number, number] */
		input.mouse = () => {
			return [
				world.camera.x + mouseX * (innerWidth / innerHeight) * 540 / world.camera.scale,
				world.camera.y + mouseY * 540 / world.camera.scale,
			];
		};

		function mouse() {
			const [x, y] = input.mouse();
			net.move(x, y);
			lastMouseX = mouseX;
			lastMouseY = mouseY;
		}

		function unfocused() {
			return ui.escOverlayVisible() || document.activeElement?.tagName === 'INPUT';
		}

		let lastMovement = performance.now();
		input.move = () => {
			// called every frame because tabbing out reduces setInterval frequency, which messes up mouse flick fixes
			const now = performance.now();
			if (now - lastMovement < 40) return;
			lastMovement = now;

			// if holding w with sigmod, tabbing out, then tabbing in, avoid spitting out only one W
			const consumedForceW = forceW;
			forceW = false;

			// allow flicking mouse then immediately switching tabs in the same tick
			if (document.visibilityState === 'hidden' && lastMouseX === mouseX && lastMouseY === mouseY) return;
			mouse();

			if (consumedForceW || w) net.w();
		};

		// anti-afk when another tab is playing
		let lastCheck = performance.now();
		input.antiAfk = () => {
			const now = performance.now();
			// only check every 10s, don't want to spam packets but don't want to miss resetting the afk timer
			if (now - lastCheck < 10_000) return;
			lastCheck = now;

			// check if any other tabs are *alive*
			for (const tab of sync.others.values()) {
				if (tab.owned.size > 0) {
					net.qup(); // send literally any packet at all
					break;
				}
			}
		};

		// sigmod freezes the player by overlaying an invisible div, so we just listen for canvas movements instead
		addEventListener('mousemove', e => {
			if (ui.escOverlayVisible()) return;
			// sigmod freezes the player by overlaying an invisible div, so we respect it
			if (e.target instanceof HTMLDivElement
				&& /** @type {CSSUnitValue | undefined} */ (e.target.attributeStyleMap.get('z-index'))?.value === 99)
				return;
			mouseX = (e.clientX / innerWidth * 2) - 1;
			mouseY = (e.clientY / innerHeight * 2) - 1;
		});

		addEventListener('wheel', e => {
			if (unfocused()) return;
			let deltaY;
			if (e.deltaMode === e.DOM_DELTA_PAGE) {
				// support for the very obscure "scroll by page" setting in windows
				deltaY = e.deltaY;
			} else { // i don't think browsers support DOM_DELTA_LINE, so assume DOM_DELTA_PIXEL
				deltaY = e.deltaY / 100;
			}
			input.zoom *= 0.8 ** (deltaY * settings.scrollFactor);
			const minZoom = (!settings.mergeCamera && !aux.settings.zoomout) ? 1 : 0.8 ** 10;
			input.zoom = Math.min(Math.max(input.zoom, minZoom), 0.8 ** -11);
			sync.zoom();
		});

		addEventListener('keydown', e => {
			if (e.code === 'Escape') {
				if (document.activeElement === ui.chat.input)
					ui.chat.input.blur();
				else
					ui.toggleEscOverlay();
				return;
			}

			if (unfocused()) {
				if (e.code === 'Enter' && document.activeElement === ui.chat.input && ui.chat.input.value.length > 0) {
					net.chat(ui.chat.input.value.slice(0, 15));
					ui.chat.input.value = '';
					ui.chat.input.blur();
				}

				return;
			}

			switch (e.code) {
				case 'KeyQ':
					if (!e.repeat)
						net.qdown();
					break;
				case 'KeyW':
					forceW = true;
					w = true;
					break;
				case 'Space': {
					if (!e.repeat) {
						// send mouse position immediately, so the split will go in the correct direction.
						// setTimeout is used to ensure that our mouse position is actually updated (it comes after
						// keydown events)
						setTimeout(() => {
							mouse();
							net.split();
						});
					}
					break;
				}
				case 'Enter': {
					ui.chat.input.focus();
					break;
				}
			}

			if (e.ctrlKey && e.code === 'Tab') {
				e.returnValue = true; // undo e.preventDefault() by SigMod
				e.stopImmediatePropagation(); // prevent SigMod from calling e.preventDefault() afterwards
			} else if (settings.blockBrowserKeybinds && e.code !== 'F11')
				e.preventDefault();
			else if ((e.ctrlKey && e.code === 'KeyW') || e.code === 'Tab')
				e.preventDefault();
		});

		addEventListener('keyup', e => {
			// do not check if unfocused
			if (e.code === 'KeyQ')
				net.qup();
			else if (e.code === 'KeyW')
				w = false;
		});

		// when switching tabs, make sure W is not being held
		addEventListener('blur', () => {
			// force sigmod to get the signal
			if (aux.sigmodSettings?.rapidFeedKey)
				document.dispatchEvent(new KeyboardEvent('keyup', { key: aux.sigmodSettings.rapidFeedKey }));

			w = false;
		});

		addEventListener('beforeunload', e => {
			e.preventDefault();
		});

		// prevent right clicking on the game
		ui.game.canvas.addEventListener('contextmenu', e => e.preventDefault());

		// prevent dragging when some things are selected - i have a habit of unconsciously clicking all the time,
		// making me regularly drag text, disabling my mouse inputs for a bit
		addEventListener('dragstart', e => e.preventDefault());



		// #2 : play and spectate buttons, and captcha
		/** @param {boolean} spectating */
		function playData(spectating) {
			/** @type {HTMLInputElement | null} */
			const nickElement = document.querySelector('input#nick');
			/** @type {HTMLInputElement | null} */
			const password = document.querySelector('input#password');

			return {
				state: spectating ? 2 : undefined,
				name: nickElement?.value ?? '',
				skin: aux.settings.skin,
				token: aux.token?.token,
				sub: (aux.userData?.subscription ?? 0) > Date.now(),
				clan: aux.userData?.clan,
				showClanmates: aux.settings.showClanmates,
				password: password?.value,
			};
		}

		/** @type {HTMLButtonElement} */
		const play = aux.require(
			document.querySelector('button#play-btn'),
			'Can\'t find the play button. Try reloading the page?',
		);
		/** @type {HTMLButtonElement} */
		const spectate = aux.require(
			document.querySelector('button#spectate-btn'),
			'Can\'t find the spectate button. Try reloading the page?',
		);

		play.disabled = spectate.disabled = true;
		const playText = play.textContent;

		(async () => {
			const mount = document.createElement('div');
			mount.id = 'sf-captcha-mount';
			mount.style.display = 'none';
			play.parentNode?.insertBefore(mount, play);

			/** @type {Set<() => void> | undefined} */
			let onGrecaptchaReady = new Set();
			/** @type {Set<() => void> | undefined} */
			let onTurnstileReady = new Set();
			let grecaptcha, turnstile, CAPTCHA2, CAPTCHA3, TURNSTILE;

			let readyCheck;
			readyCheck = setInterval(() => {
				// it's possible that recaptcha or turnstile may be removed in the future, so we be redundant to stay
				// safe
				if (onGrecaptchaReady) {
					({ grecaptcha, CAPTCHA2, CAPTCHA3 } = /** @type {any} */ (window));
					if (grecaptcha?.ready && CAPTCHA2 && CAPTCHA3) {
						const handlers = onGrecaptchaReady;
						onGrecaptchaReady = undefined;

						grecaptcha.ready(() => {
							handlers.forEach(cb => cb());
							// prevent game.js from using grecaptcha and messing things up
							({ grecaptcha } = /** @type {any} */ (window));
							/** @type {any} */ (window).grecaptcha = {
								execute: () => { },
								ready: () => { },
								render: () => { },
								reset: () => { },
							};
						});
					}
				}

				if (onTurnstileReady) {
					({ turnstile, TURNSTILE } = /** @type {any} */ (window));
					if (turnstile?.ready && TURNSTILE) {
						const handlers = onTurnstileReady;
						onTurnstileReady = undefined;
						handlers.forEach(cb => cb());

						// prevent game.js from using turnstile and messing things up
						/** @type {any} */ (window).turnstile = {
							execute: () => { },
							ready: () => { },
							render: () => { },
							reset: () => { },
						};
					}
				}

				if (!onGrecaptchaReady && !onTurnstileReady)
					clearInterval(readyCheck);
			}, 50);

			/**
			 * @param {string} url
			 * @returns {Promise<string>}
			 */
			const tokenVariant = async url => {
				const host = new URL(url).host;
				if (host.includes('sigmally.com'))
					return aux.oldFetch(`https://${host}/server/recaptcha/v3`)
						.then(res => res.json())
						.then(res => res.version ?? 'none');
				else
					return Promise.resolve('none');
			};

			/** @type {unique symbol} */
			const used = Symbol();
			/** @type {unique symbol} */
			const waiting = Symbol();
			let nextTryAt = 0;
			/** @type {undefined | typeof waiting | typeof used
			 * | { variant: string, token: string | undefined }} */
			let token = undefined;
			/** @type {string | undefined} */
			let turnstileHandle;
			/** @type {number | undefined} */
			let v2Handle;

			input.captchaAcceptedAt = undefined;

			/**
			 * @param {string} url
			 * @param {string} variant
			 * @param {string | undefined} captchaToken
			 */
			const publishToken = (url, variant, captchaToken) => {
				const url2 = net.url();
				play.textContent = `${playText} (validating)`;
				if (url === url2) {
					const host = new URL(url).host;
					aux.oldFetch(`https://${host}/server/recaptcha/v3`, {
						method: 'POST',
						headers: { 'content-type': 'application/json' },
						body: JSON.stringify({ token: captchaToken }),
					})
						.then(res => res.json())
						.then(res => {
							if (res.status === 'complete') {
								token = used;
								play.disabled = spectate.disabled = false;
								play.textContent = playText;
								input.captchaAcceptedAt = performance.now();
								net.rejected = false; // wait until we try connecting again
							}
						})
						.catch(err => {
							play.textContent = playText;
							token = undefined;
							nextTryAt = performance.now() + 400;
							throw err;
						});
				} else {
					token = { variant, token: captchaToken };
				}
			};

			setInterval(() => {
				const canPlay = !net.rejected && net.connection()?.readyState === WebSocket.OPEN;
				if (play.disabled !== !canPlay) {
					play.disabled = spectate.disabled = !canPlay;
					play.textContent = playText;
				}

				if (token === waiting) return;
				if (!net.rejected) return;

				const url = net.url();

				if (typeof token !== 'object') {
					// get a new token if first time, or if we're on a new connection now
					if (performance.now() < nextTryAt) return;

					token = waiting;
					play.disabled = spectate.disabled = true;
					play.textContent = `${playText} (getting type)`;
					tokenVariant(url)
						.then(async variant => {
							const url2 = net.url();
							if (url !== url2) {
								// server changed and may want a different variant; restart
								token = undefined;
								return;
							}

							if (variant === 'v2') {
								mount.style.display = 'block';
								play.style.display = spectate.style.display = 'none';
								play.textContent = playText;
								if (v2Handle !== undefined) {
									grecaptcha.reset(v2Handle);
								} else {
									const cb = () => void (v2Handle = grecaptcha.render('sf-captcha-mount', {
										sitekey: CAPTCHA2,
										callback: v2 => {
											mount.style.display = 'none';
											play.style.display = spectate.style.display = '';
											publishToken(url, variant, v2);
										},
									}));
									if (onGrecaptchaReady)
										onGrecaptchaReady.add(cb);
									else
										grecaptcha.ready(cb);
								}
							} else if (variant === 'v3') {
								play.textContent = `${playText} (solving)`;
								const cb = () => grecaptcha.execute(CAPTCHA3)
									.then(v3 => publishToken(url, variant, v3));
								if (onGrecaptchaReady)
									onGrecaptchaReady.add(cb);
								else
									grecaptcha.ready(cb);
							} else if (variant === 'turnstile') {
								mount.style.display = 'block';
								play.style.display = spectate.style.display = 'none';
								play.textContent = playText;
								if (turnstileHandle !== undefined) {
									turnstile.reset(turnstileHandle);
								} else {
									const cb = () => void (turnstileHandle = turnstile.render('#sf-captcha-mount', {
										sitekey: TURNSTILE,
										callback: turnstileToken => {
											mount.style.display = 'none';
											play.style.display = spectate.style.display = '';
											publishToken(url, variant, turnstileToken);
										},
									}));
									if (onTurnstileReady)
										onTurnstileReady.add(cb);
									else
										cb();
								}
							} else {
								// server wants "none" or unknown token variant; don't show a captcha
								publishToken(url, variant, undefined);
								play.disabled = spectate.disabled = false;
								play.textContent = playText;
							}
						}).catch(err => {
							token = undefined;
							nextTryAt = performance.now() + 400;
							console.warn('Error while getting token variant:', err);
						});
				} else {
					// token is ready to be used, check variant
					const got = token;
					token = waiting;
					play.disabled = spectate.disabled = true;
					play.textContent = `${playText} (getting type)`;
					tokenVariant(url)
						.then(variant2 => {
							if (got.variant !== variant2) {
								// server wants a different token variant
								token = undefined;
							} else
								publishToken(url, got.variant, got.token);
						}).catch(err => {
							token = got;
							nextTryAt = performance.now() + 400;
							console.warn('Error while getting token variant:', err);
						});
				}
			}, 100);

			/** @param {MouseEvent} e */
			async function clickHandler(e) {
				if (net.connection() && !net.rejected) {
					ui.toggleEscOverlay(false);
					net.play(playData(e.currentTarget === spectate));
				}
			}

			play.addEventListener('click', clickHandler);
			spectate.addEventListener('click', clickHandler);
		})();

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
		/** @type {{
		 * 	vao: WebGLVertexArrayObject,
		 * 	circleBuffer: WebGLBuffer,
		 * 	alphaBuffer: WebGLBuffer,
		 * 	alphaBufferSize: number }[]} */
		glconf.vao = [];

		const gl = ui.game.gl;
		/** @type {Map<string, number>} */
		const uboBindings = new Map();

		/**
		 * @param {string} name
		 * @param {number} type
		 * @param {string} source
		 */
		function shader(name, type, source) {
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

		/**
		 * @param {string} name
		 * @param {string} vSource
		 * @param {string} fSource
		 * @param {string[]} ubos
		 * @param {string[]} textures
		 */
		function program(name, vSource, fSource, ubos, textures) {
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
				if (binding === undefined)
					uboBindings.set(tag, binding = uboBindings.size);
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
			borderUbo: `layout(std140) uniform Border { // size = 0x24
				vec4 u_border_color; // @ 0x00, i = 0
				vec4 u_border_xyzw_lrtb; // @ 0x10, i = 4
				int u_border_flags; // @ 0x20, i = 8
				float u_background_width; // @ 0x24, i = 9
				float u_background_height; // @ 0x28, i = 10
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
				vec2 u_tracer_pos1; // @ 0x00, i = 0
				vec2 u_tracer_pos2; // @ 0x08, i = 2
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

					out_color = out_color * (1.0 - alpha) + u_border_color * alpha;
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
				flat out int f_show_skin;
				flat out vec4 f_subtle_outline;
				flat out float f_subtle_radius;
				flat out vec4 f_unsplittable_outline;
				flat out float f_unsplittable_radius;
				out vec2 v_vertex;
				out vec2 v_uv;

				void main() {
					f_blur = 0.5 * u_cell_radius * (540.0 * u_camera_scale);
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

					// active multibox outlines (thick, a % of the visible cell radius)
					f_active_radius = 1.0 - u_cell_active_outline_thickness;
					if ((u_cell_flags & 0x0c) != 0) {
						f_active_outline = (u_cell_flags & 0x04) != 0 ? u_cell_active_outline : u_cell_inactive_outline;
					} else {
						f_active_outline = vec4(0, 0, 0, 0);
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

					v_vertex = a_vertex;
					v_uv = a_vertex * (u_cell_radius / u_cell_radius_skin) * 0.5 + 0.5;

					vec2 clip_pos = -u_camera_pos + u_cell_pos + v_vertex * u_cell_radius;
					clip_pos *= u_camera_scale * vec2(1.0 / u_camera_ratio, -1.0);
					gl_Position = vec4(clip_pos, 0, 1);
				}
			`, `
				${parts.boilerplate}
				flat in vec4 f_active_outline;
				flat in float f_active_radius;
				flat in float f_blur;
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

					// skin; square clipping, outskirts should use the cell color
					if (f_show_skin != 0 && 0.0 <= min(v_uv.x, v_uv.y) && max(v_uv.x, v_uv.y) <= 1.0) {
						vec4 tex = texture(u_skin, v_uv);
						out_color = out_color * (1.0 - tex.a) + tex;
					} else {
						out_color = u_cell_color;
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

				void main() {
					vec4 normal = texture(u_texture, v_uv);

					if (u_text_silhouette_enabled != 0) {
						vec4 silhouette = texture(u_silhouette, v_uv);

						// #fff - #000 => color (text)
						// #fff - #fff => #fff (respect emoji)
						// #888 - #888 => #888 (respect emoji)
						// #fff - #888 => #888 + color/2 (blur/antialias)
						out_color = silhouette + (normal - silhouette) * v_color;
					} else {
						out_color = normal * v_color;
					}

					out_color.a *= u_text_alpha;
				}
			`, ['Camera', 'Cell', 'Text'], ['u_texture', 'u_silhouette']);

			programs.tracer = program('tracer', `
				${parts.boilerplate}
				layout(location = 0) in vec2 a_vertex;
				${parts.cameraUbo}
				${parts.tracerUbo}
				out vec2 v_vertex;

				void main() {
					v_vertex = a_vertex;
					float alpha = (a_vertex.x + 1.0) / 2.0;
					float d = length(u_tracer_pos2 - u_tracer_pos1);
					float thickness = 0.002 / u_camera_scale;
					// black magic
					vec2 world_pos = u_tracer_pos1 + (u_tracer_pos2 - u_tracer_pos1)
						* mat2(alpha, a_vertex.y / d * thickness, a_vertex.y / d * -thickness, alpha);

					vec2 clip_pos = -u_camera_pos + world_pos;
					clip_pos *= u_camera_scale * vec2(1.0 / u_camera_ratio, -1.0);
					gl_Position = vec4(clip_pos, 0, 1);
				}
			`, `
				${parts.boilerplate}
				in vec2 v_pos;
				out vec4 out_color;

				void main() {
					out_color = vec4(0.5, 0.5, 0.5, 0.25);
				}
			`, ['Camera', 'Tracer'], []);

			// initialize two VAOs; one for pellets, one for cell glow only
			glconf.vao = [];
			for (let i = 0; i < 2; ++i) {
				const vao = /** @type {WebGLVertexArrayObject} */ (gl.createVertexArray());
				gl.bindVertexArray(vao);

				// square (location = 0), used for all instances
				gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
				gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([ -1, -1,   1, -1,   -1, 1,   1, 1 ]), gl.STATIC_DRAW);
				gl.enableVertexAttribArray(0);
				gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

				// pellet/circle buffer (each instance is 6 floats or 24 bytes)
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

				// pellet/circle alpha buffer, updated every frame
				const alphaBuffer = /** @type {WebGLBuffer} */ (gl.createBuffer());
				gl.bindBuffer(gl.ARRAY_BUFFER, alphaBuffer);
				// a_cell_alpha, float (location = 4)
				gl.enableVertexAttribArray(4);
				gl.vertexAttribPointer(4, 1, gl.FLOAT, false, 0, 0);
				gl.vertexAttribDivisor(4, 1);

				glconf.vao.push({ vao, alphaBuffer, circleBuffer, alphaBufferSize: 0 });
			}

			gl.bindVertexArray(glconf.vao[0].vao);
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
		document.fonts.ready.then(() => void (minimapCache = undefined)); // make sure minimap is drawn with Ubuntu font


		// #2 : define helper functions
		const { resetTextureCache, textureFromCache } = (() => {
			/** @type {Map<string, { texture: WebGLTexture, width: number, height: number } | null>} */
			const cache = new Map();
			render.textureCache = cache;

			return {
				resetTextureCache: () => cache.clear(),
				/**
				 * @param {string} src
				 * @returns {{ texture: WebGLTexture, width: number, height: number } | undefined}
				 */
				textureFromCache: src => {
					const cached = cache.get(src);
					if (cached !== undefined)
						return cached ?? undefined;

					cache.set(src, null);

					const image = new Image();
					image.crossOrigin = 'anonymous';
					image.addEventListener('load', () => {
						const texture = /** @type {WebGLTexture} */ (gl.createTexture());
						if (!texture) return;

						gl.bindTexture(gl.TEXTURE_2D, texture);
						gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
						gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_NEAREST);
						gl.generateMipmap(gl.TEXTURE_2D);
						cache.set(src, { texture, width: image.width, height: image.height });
					});
					image.src = src;

					return undefined;
				},
			};
		})();
		render.resetTextureCache = resetTextureCache;

		const { refreshTextCache, massTextFromCache, resetTextCache, textFromCache } = (() => {
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
			const realShadowBlurSet
				= aux.require(realProps.shadowBlur.set, 'did CanvasRenderingContext2D spec change?').bind(ctx);
			const realShadowColorSet
				= aux.require(realProps.shadowColor.set, 'did CanvasRenderingContext2D spec change?').bind(ctx);
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

				const baseTextSize = devicePixelRatio > 1 ? 96 : 72;
				const textSize = baseTextSize * (mass ? 0.5 * settings.massScaleFactor : settings.nameScaleFactor);
				const lineWidth = Math.ceil(textSize / 10) * settings.textOutlinesFactor;

				let font = '';
				if (mass ? settings.massBold : settings.nameBold)
					font = 'bold';
				font += ' ' + textSize + 'px Ubuntu';

				ctx.font = font;
				// if rendering an empty string (somehow) then width can be 0 with no outlines
				canvas.width = (ctx.measureText(text).width + lineWidth * 2) || 1;
				canvas.height = textSize * 3;
				ctx.clearRect(0, 0, canvas.width, canvas.height);

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
				if (lineWidth > 0) ctx.strokeText(text + ' ', lineWidth, textSize * 1.5);
				ctx.shadowColor = 'transparent';
				ctx.fillText(text + ' ', lineWidth, textSize * 1.5);

				const data = ctx.getImageData(0, 0, canvas.width, canvas.height);

				gl.bindTexture(gl.TEXTURE_2D, texture);
				gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, data);
				gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST_MIPMAP_LINEAR);
				gl.generateMipmap(gl.TEXTURE_2D);
				return texture;
			};

			let massAspectRatio = 1; // assumption: all mass digits are the same aspect ratio - true in the Ubuntu font
			/** @type {(WebGLTexture | undefined)[]} */
			const massTextCache = [];

			/**
			 * @param {string} digit
			 * @returns {{ aspectRatio: number, texture: WebGLTexture | null }}
			 */
			const massTextFromCache = digit => {
				let cached = massTextCache[digit];
				if (!cached) {
					cached = massTextCache[digit] = texture(digit, false, true);
					massAspectRatio = canvas.width / canvas.height;
				}

				return { aspectRatio: massAspectRatio, texture: cached };
			};

			const resetTextCache = () => {
				cache.clear();
				while (massTextCache.pop());
			};

			let drawnMassBold = false;
			let drawnMassScaleFactor = -1;
			let drawnNamesBold = false;
			let drawnNamesScaleFactor = -1;
			let drawnOutlinesFactor = 1;

			const refreshTextCache = () => {
				if (drawnMassBold !== settings.massBold || drawnMassScaleFactor !== settings.massScaleFactor
					|| drawnNamesScaleFactor !== settings.nameScaleFactor || drawnNamesBold !== settings.nameBold
					|| drawnOutlinesFactor !== settings.textOutlinesFactor
				) {
					resetTextCache();
					drawnMassBold = settings.massBold;
					drawnMassScaleFactor = settings.massScaleFactor;
					drawnNamesBold = settings.nameBold;
					drawnNamesScaleFactor = settings.nameScaleFactor;
					drawnOutlinesFactor = settings.textOutlinesFactor;
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
					/** @type {CacheEntry<T>} */
					entry = {
						text: texture(shortened, false, false),
						aspectRatio: canvas.width / canvas.height, // mind the execution order
						silhouette: silhouette ? texture(shortened, true, false) : undefined,
						accessed: performance.now(),
					};
					cache.set(text, entry);
				} else {
					entry.accessed = performance.now();
				}

				if (silhouette && entry.silhouette === undefined) {
					setTimeout(() => {
						entry.silhouette = texture(aux.trim(text), true, false);
					});
				}

				return entry;
			};

			// reload text once Ubuntu has loaded, prevents some serif fonts from being locked in
			document.fonts.ready.then(() => resetTextCache());

			return { refreshTextCache, massTextFromCache, resetTextCache, textFromCache };
		})();
		render.resetTextCache = resetTextCache;
		render.textFromCache = textFromCache;

		let cellAlpha = new Float32Array(0);
		let cellBuffer = new Float32Array(0);
		let pelletAlpha = new Float32Array(0);
		let pelletBuffer = new Float32Array(0);
		let uploadedPellets = 0;
		/**
		 * @param {'cells' | 'pellets'} key
		 * @param {number=} now
		 */
		render.upload = (key, now) => {
			if ((key === 'pellets' && aux.sigmodSettings?.hidePellets)
				|| performance.now() - render.lastFrame > 45_000) {
				// do not render pellets on inactive windows (very laggy!)
				uploadedPellets = 0;
				return;
			}

			now ??= performance.now(); // the result will never actually be used, just for type checking
			const vao = glconf.vao[key === 'pellets' ? 0 : 1];

			const map = (settings.mergeViewArea && sync.merge) ? sync.merge : world;

			// find expected # of pellets (exclude any that are being *animated*)
			let expected = 0;
			if (key === 'pellets') {
				if (sync.merge) {
					for (const collection of sync.merge.pellets.values()) {
						if (collection.merged?.deadTo === -1) ++expected;
					}
				} else {
					for (const pellet of world.pellets.values()) {
						if (pellet.deadTo === -1) ++expected;
					}
				}
			} else {
				expected = map.cells.size;
			}

			// grow the pellet buffer by 2x multiples if necessary
			let alphaBuffer = key === 'cells' ? cellAlpha : pelletAlpha;
			let objBuffer = key === 'cells' ? cellBuffer : pelletBuffer;
			let instances = alphaBuffer.length || 1;
			while (instances < expected) {
				instances *= 2;
			}
			// when the webgl context is lost, the buffer sizes get reset to zero
			const resizing = instances * 4 !== vao.alphaBufferSize;
			if (resizing) {
				if (key === 'pellets') {
					alphaBuffer = pelletAlpha = new Float32Array(instances);
					objBuffer = pelletBuffer = new Float32Array(instances * 7);
				} else {
					alphaBuffer = cellAlpha = new Float32Array(instances);
					objBuffer = cellBuffer = new Float32Array(instances * 7);
				}
			}

			const color = key === 'pellets' ? aux.sigmodSettings?.foodColor : aux.sigmodSettings?.cellColor;
			const foodBlank = key === 'pellets' && color?.[0] === 0 && color?.[1] === 0 && color?.[2] === 0;

			let i = 0;
			/** @param {Cell} cell */
			const iterate = cell => {
				/** @type {number} */
				let nx, ny, nr;
				if (key !== 'cells') {
					if (cell.deadTo !== -1) return;
					nx = cell.nx; ny = cell.ny; nr = cell.nr;
				} else {
					let jr;
					({ x: nx, y: ny, r: nr, jr } = world.xyr(cell, undefined, now));
					if (aux.settings.jellyPhysics) nr = jr;
				}

				objBuffer[i * 7] = nx;
				objBuffer[i * 7 + 1] = ny;
				objBuffer[i * 7 + 2] = nr;
				if (color && !foodBlank) {
					objBuffer[i * 7 + 3] = color[0]; objBuffer[i * 7 + 4] = color[1];
					objBuffer[i * 7 + 5] = color[2]; objBuffer[i * 7 + 6] = color[3];
				} else {
					objBuffer[i * 7 + 3] = cell.Rgb; objBuffer[i * 7 + 4] = cell.rGb;
					objBuffer[i * 7 + 5] = cell.rgB; objBuffer[i * 7 + 6] = foodBlank ? color[3] : 1;
				}
				++i;
			};
			if (sync.merge) {
				for (const collection of sync.merge[key].values()) {
					if (collection.merged) {
						iterate(collection.merged);
					}
				}
			} else {
				for (const cell of world[key].values()) {
					iterate(cell);
				}
			}

			// now, upload data
			if (resizing) {
				gl.bindBuffer(gl.ARRAY_BUFFER, vao.alphaBuffer);
				gl.bufferData(gl.ARRAY_BUFFER, alphaBuffer.byteLength, gl.STATIC_DRAW);
				gl.bindBuffer(gl.ARRAY_BUFFER, vao.circleBuffer);
				gl.bufferData(gl.ARRAY_BUFFER, objBuffer, gl.STATIC_DRAW);
				vao.alphaBufferSize = alphaBuffer.byteLength;
			} else {
				gl.bindBuffer(gl.ARRAY_BUFFER, vao.circleBuffer);
				gl.bufferSubData(gl.ARRAY_BUFFER, 0, objBuffer);
			}
			gl.bindBuffer(gl.ARRAY_BUFFER, null);

			if (key === 'pellets') uploadedPellets = expected;
		};


		// #3 : define ubo views
		// firefox adds some padding to uniform buffer sizes, so best to check its size
		gl.bindBuffer(gl.UNIFORM_BUFFER, glconf.uniforms.Border);
		const borderUboBuffer = new ArrayBuffer(gl.getBufferParameter(gl.UNIFORM_BUFFER, gl.BUFFER_SIZE));
		// must reference an arraybuffer for the memory to be shared between these views
		const borderUboFloats = new Float32Array(borderUboBuffer);
		const borderUboInts = new Int32Array(borderUboBuffer);

		gl.bindBuffer(gl.UNIFORM_BUFFER, glconf.uniforms.Cell);
		const cellUboBuffer = new ArrayBuffer(gl.getBufferParameter(gl.UNIFORM_BUFFER, gl.BUFFER_SIZE));
		const cellUboFloats = new Float32Array(cellUboBuffer);
		const cellUboInts = new Int32Array(cellUboBuffer);

		gl.bindBuffer(gl.UNIFORM_BUFFER, glconf.uniforms.Text);
		const textUboBuffer = new ArrayBuffer(gl.getBufferParameter(gl.UNIFORM_BUFFER, gl.BUFFER_SIZE));
		const textUboFloats = new Float32Array(textUboBuffer);
		const textUboInts = new Int32Array(textUboBuffer);

		gl.bindBuffer(gl.UNIFORM_BUFFER, glconf.uniforms.Tracer);
		const tracerUboBuffer = new ArrayBuffer(gl.getBufferParameter(gl.UNIFORM_BUFFER, gl.BUFFER_SIZE));
		const tracerUboFloats = new Float32Array(tracerUboBuffer);

		gl.bindBuffer(gl.UNIFORM_BUFFER, null); // leaving uniform buffer bound = scary!


		// #4 : define the render function
		render.fps = 0;
		render.lastFrame = performance.now();
		function renderGame() {
			const now = performance.now();
			const dt = Math.max(now - render.lastFrame, 0.1) / 1000; // there's a chance (now - lastFrame) can be 0
			render.fps += (1 / dt - render.fps) / 10;
			render.lastFrame = now;

			if (gl.isContextLost()) {
				requestAnimationFrame(renderGame);
				return;
			}

			// get settings
			const defaultVirusSrc = '/assets/images/viruses/2.png';
			const virusSrc = aux.sigmodSettings?.virusImage ?? defaultVirusSrc;

			const showNames = aux.sigmodSettings?.showNames ?? true;

			const { cellColor, foodColor, outlineColor, skinReplacement } = aux.sigmodSettings ?? {};

			/** @type {HTMLInputElement | null} */
			const nickElement = document.querySelector('input#nick');
			const nick = nickElement?.value ?? '?';

			refreshTextCache();

			// note: most routines are named, for benchmarking purposes
			(function updateGame() {
				world.moveCamera();
				input.move();
				sync.frame();
			})();

			(function setGlobalUniforms() {
				// note that binding the same buffer to gl.UNIFORM_BUFFER twice in a row causes it to not update.
				// why that happens is completely beyond me but oh well.
				// for consistency, we always bind gl.UNIFORM_BUFFER to null directly after updating it.
				gl.bindBuffer(gl.UNIFORM_BUFFER, glconf.uniforms.Camera);
				gl.bufferSubData(gl.UNIFORM_BUFFER, 0, new Float32Array([
					ui.game.canvas.width / ui.game.canvas.height, world.camera.scale / 540,
					world.camera.x, world.camera.y,
				]));
				gl.bindBuffer(gl.UNIFORM_BUFFER, null);

				gl.bindBuffer(gl.UNIFORM_BUFFER, glconf.uniforms.CellSettings);
				gl.bufferSubData(gl.UNIFORM_BUFFER, 0, new Float32Array([
					...settings.outlineMultiColor, // cell_active_outline
					...settings.outlineMultiInactiveColor, // cell_inactive_outline
					...(aux.settings.darkTheme ? [1, 1, 1, 1] : [0, 0, 0, 1]), // cell_unsplittable_outline
					...(outlineColor ?? [0, 0, 0, 0]), // cell_subtle_outline_override
					settings.outlineMulti,
				]));
				gl.bindBuffer(gl.UNIFORM_BUFFER, null);
			})();

			(function background() {
				if (aux.sigmodSettings?.mapColor) {
					gl.clearColor(...aux.sigmodSettings.mapColor);
				} else if (aux.settings.darkTheme) {
					gl.clearColor(0x11 / 255, 0x11 / 255, 0x11 / 255, 1); // #111
				} else {
					gl.clearColor(0xf2 / 255, 0xfb / 255, 0xff / 255, 1); // #f2fbff
				}
				gl.clear(gl.COLOR_BUFFER_BIT);

				gl.useProgram(glconf.programs.bg);

				const texture
					= textureFromCache(settings.background || (aux.settings.darkTheme ? darkGridSrc : lightGridSrc));
				gl.bindTexture(gl.TEXTURE_2D, texture?.texture ?? null);
				const repeating = texture && texture.width <= 1024 && texture.height <= 1024;

				let borderColor;
				let borderLrtb;
				if (aux.settings.showBorder && world.border) {
					borderColor = [0, 0, 1, 1]; // #00ff
					borderLrtb = world.border;
				} else {
					borderColor = [0, 0, 0, 0]; // transparent
					borderLrtb = { l: 0, r: 0, t: 0, b: 0 };
				}

				// u_border_color
				borderUboFloats[0] = borderColor[0]; borderUboFloats[1] = borderColor[1];
				borderUboFloats[2] = borderColor[2]; borderUboFloats[3] = borderColor[3];
				// u_border_xyzw_lrtb
				borderUboFloats[4] = borderLrtb.l;
				borderUboFloats[5] = borderLrtb.r;
				borderUboFloats[6] = borderLrtb.t;
				borderUboFloats[7] = borderLrtb.b;

				// flags
				borderUboInts[8] = ((aux.settings.showGrid && texture) ? 0x01 : 0)
					| (aux.settings.darkTheme ? 0x02 : 0) | (repeating ? 0x04 : 0);

				// u_background_width and u_background_height
				borderUboFloats[9] = texture?.width ?? 1;
				borderUboFloats[10] = texture?.height ?? 1;

				gl.bindBuffer(gl.UNIFORM_BUFFER, glconf.uniforms.Border);
				gl.bufferSubData(gl.UNIFORM_BUFFER, 0, borderUboFloats);
				gl.bindBuffer(gl.UNIFORM_BUFFER, null);
				gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
			})();

			(function cells() {
				// for white cell outlines
				let nextCellIdx = world.mine.length;
				const canSplit = world.mine.map(id => {
					let cell;
					if (sync.merge) {
						cell = sync.merge.cells.get(id)?.merged;
					} else {
						cell = world.cells.get(id);
					}
					if (!cell) {
						--nextCellIdx;
						return false;
					}

					if (cell.nr < 128)
						return false;

					return nextCellIdx++ < 16;
				});

				/**
				 * @param {Cell} cell
				 * @returns {number}
				 */
				const calcAlpha = cell => {
					let alpha = (now - cell.born) / 100;
					if (cell.deadAt !== undefined) {
						const alpha2 = 1 - (now - cell.deadAt) / 100;
						if (alpha2 < alpha) alpha = alpha2;
					}
					alpha = alpha > 1 ? 1 : alpha < 0 ? 0 : alpha;
					return alpha;
				};

				/**
				 * @param {Cell} cell
				 */
				function draw(cell) {
					// #1 : draw cell
					gl.useProgram(glconf.programs.cell);

					const alpha = calcAlpha(cell);
					cellUboFloats[8] = alpha * settings.cellOpacity;

					/** @type {Cell | undefined} */
					let killer;
					if (cell.deadTo !== -1) {
						if (sync.merge) {
							killer = sync.merge.cells.get(cell.deadTo)?.merged;
						} else {
							killer = world.cells.get(cell.deadTo);
						}
					}
					const { x, y, r, jr } = world.xyr(cell, killer, now);
					// without jelly physics, the radius of cells is adjusted such that its subtle outline doesn't go
					// past its original radius.
					// jelly physics does not do this, so colliding cells need to look kinda 'joined' together,
					// so we multiply the radius by 1.02 (approximately the size increase from the stroke thickness)
					cellUboFloats[2] = x;
					cellUboFloats[3] = y;
					if (aux.settings.jellyPhysics && !cell.jagged) {
						const strokeThickness = Math.max(jr * 0.01, 10);
						cellUboFloats[0] = jr + strokeThickness;
						cellUboFloats[1] = (settings.jellySkinLag ? r : jr) + strokeThickness;
					} else {
						cellUboFloats[0] = cellUboFloats[1] = r;
					}

					if (cell.jagged) {
						const virusTexture = textureFromCache(virusSrc);
						if (virusTexture) {
							gl.bindTexture(gl.TEXTURE_2D, virusTexture.texture);
							cellUboInts[9] = 0x01; // skin and nothing else
							// draw a fully transparent cell
							cellUboFloats[4] = cellUboFloats[5] = cellUboFloats[6] = cellUboFloats[7] = 0;
						} else {
							cellUboInts[9] = 0;
							cellUboFloats[4] = 1;
							cellUboFloats[5] = 0;
							cellUboFloats[6] = 0;
							cellUboFloats[7] = 0.5;
						}

						gl.bindBuffer(gl.UNIFORM_BUFFER, glconf.uniforms.Cell);
						gl.bufferSubData(gl.UNIFORM_BUFFER, 0, cellUboBuffer);
						gl.bindBuffer(gl.UNIFORM_BUFFER, null);
						gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
						// draw default viruses twice for better contrast against light theme
						if (!aux.settings.darkTheme && virusSrc === defaultVirusSrc)
							gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
						return;
					}

					cellUboInts[9] = 0;
					const color = (cell.pellet ? foodColor : cellColor) ?? [cell.Rgb, cell.rGb, cell.rgB, 1];
					cellUboFloats[4] = color[0]; cellUboFloats[5] = color[1];
					cellUboFloats[6] = color[2]; cellUboFloats[7] = color[3];

					cellUboInts[9] |= settings.cellOutlines ? 0x02 : 0;

					if (!cell.pellet) {
						const myIndex = world.mine.indexOf(cell.id);
						if (myIndex !== -1) {
							if (world.camera.merged) cellUboInts[9] |= 0x04; // active multi outline
							if (!canSplit[myIndex] && settings.unsplittableOpacity > 0) cellUboInts[9] |= 0x10;
						}

						let skin = '';
						for (const [_, data] of sync.others) {
							if (data.owned.has(cell.id)) {
								if (world.camera.merged) cellUboInts[9] |= 0x08; // inactive multi outline
								if (settings.syncSkin) skin = data.skin;
								break;
							}
						}

						if (settings.selfSkin && (myIndex !== -1 || world.mineDead.has(cell.id))) {
							skin = settings.selfSkin;
						} else {
							if (!skin && aux.settings.showSkins && cell.skin) {
								if (skinReplacement && cell.skin.includes(skinReplacement.original + '.png'))
									skin = skinReplacement.replacement ?? skinReplacement.replaceImg ?? '';
								else
									skin = cell.skin;
							}
						}

						if (skin) {
							const texture = textureFromCache(skin);
							if (texture) {
								cellUboInts[9] |= 0x01; // skin
								gl.bindTexture(gl.TEXTURE_2D, texture.texture);
							}
						}
					}

					gl.bindBuffer(gl.UNIFORM_BUFFER, glconf.uniforms.Cell);
					gl.bufferSubData(gl.UNIFORM_BUFFER, 0, cellUboBuffer);
					gl.bindBuffer(gl.UNIFORM_BUFFER, null);
					gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

					// #2 : draw text
					if (cell.pellet) return;
					const name = cell.name || 'An unnamed cell';
					let canShow = true;
					if (!settings.showOwnName) {
						canShow = !world.mine.includes(cell.id);
						if (canShow) {
							for (const tab of sync.others.values()) {
								if (tab.owned.has(cell.id)) {
									canShow = false;
									break;
								}
							}
						}
					}
					let showThisName = canShow && showNames && cell.nr > 75;
					const showThisMass = aux.settings.showMass && cell.nr > 75;
					const clan = (canShow && settings.clans && aux.clans.get(cell.clan)) || '';
					if (!showThisName && !showThisMass && !clan) return;

					gl.useProgram(glconf.programs.text);
					textUboFloats[8] = alpha; // text_alpha

					let useSilhouette = false;
					if (cell.sub) {
						// text_color1 = #eb9500
						textUboFloats[0] = 0xeb / 255; textUboFloats[1] = 0x95 / 255;
						textUboFloats[2] = 0x00 / 255; textUboFloats[3] = 1;
						// text_color2 = #e4b110
						textUboFloats[4] = 0xe4 / 255; textUboFloats[5] = 0xb1 / 255;
						textUboFloats[6] = 0x10 / 255; textUboFloats[7];
						useSilhouette = true;
					} else {
						// text_color1 = text_color2 = #fff
						textUboFloats[0] = textUboFloats[1] = textUboFloats[2] = textUboFloats[3] = 1;
						textUboFloats[4] = textUboFloats[5] = textUboFloats[6] = textUboFloats[7] = 1;
					}

					if (name === nick) {
						const nameColor1 = aux.sigmodSettings?.nameColor1;
						const nameColor2 = aux.sigmodSettings?.nameColor2;
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
							textUboInts[11] = Number(silhouette); // text_silhouette_enabled
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
						const mass = Math.floor(cell.nr * cell.nr / 100).toString();
						for (let i = 0; i < mass.length; ++i) {
							const { aspectRatio, texture } = massTextFromCache(mass[i]);
							textUboFloats[9] = aspectRatio; // text_aspect_ratio
							// text_offset.x
							// thickness 0 => 1.00 multiplier
							// thickness 1 => 0.75
							// probably a reciprocal function
							textUboFloats[12] = (i - (mass.length - 1) / 2)
								* (1 - 0.25 * Math.sqrt(settings.textOutlinesFactor)) * settings.massScaleFactor;
							textUboFloats[13] = yOffset;
							gl.bindTexture(gl.TEXTURE_2D, texture);

							gl.bindBuffer(gl.UNIFORM_BUFFER, glconf.uniforms.Text);
							gl.bufferSubData(gl.UNIFORM_BUFFER, 0, textUboBuffer);
							gl.bindBuffer(gl.UNIFORM_BUFFER, null);
							gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
						}
					}
				}

				// draw static pellets first
				let i = 0;
				/** @param {Cell} pellet */
				const iterateStaticPellet = pellet => {
					// deadTo property should never change in between upload('pellets') calls
					if (pellet.deadTo !== -1) return;
					pelletAlpha[i++] = calcAlpha(pellet);
				};
				if (sync.merge) {
					for (const collection of sync.merge.pellets.values()) {
						if (collection.merged) iterateStaticPellet(collection.merged);
					}
				} else {
					for (const pellet of world.pellets.values()) {
						iterateStaticPellet(pellet);
					}
				}
				gl.bindBuffer(gl.ARRAY_BUFFER, glconf.vao[0].alphaBuffer);
				gl.bufferSubData(gl.ARRAY_BUFFER, 0, pelletAlpha);
				gl.bindBuffer(gl.ARRAY_BUFFER, null); // TODO: necessary unbinding?

				if (settings.pelletGlow && aux.settings.darkTheme) {
					gl.blendFunc(gl.SRC_ALPHA, gl.ONE); // make sure pellets (and glow) are visible in light theme
				}
				gl.bindBuffer(gl.UNIFORM_BUFFER, glconf.uniforms.Circle);
				gl.bufferData(gl.UNIFORM_BUFFER, new Float32Array([ 1, 0 ]), gl.STATIC_DRAW);
				gl.bindBuffer(gl.UNIFORM_BUFFER, null);

				gl.useProgram(glconf.programs.circle);
				gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, uploadedPellets);
				if (settings.pelletGlow) {
					gl.bindBuffer(gl.UNIFORM_BUFFER, glconf.uniforms.Circle);
					gl.bufferData(gl.UNIFORM_BUFFER, new Float32Array([ 0.25, 2 ]), gl.STATIC_DRAW);
					gl.bindBuffer(gl.UNIFORM_BUFFER, null);

					gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, uploadedPellets);
					gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
				}

				// then draw *animated* pellets
				/** @param {Cell} pellet */
				const iterateAnimatedPellet = pellet => {
					if (pellet.deadTo !== -1) draw(pellet); // no rtx glow is fine here
				};
				if (sync.merge) {
					for (const collection of sync.merge.pellets.values()) {
						if (collection.merged) iterateAnimatedPellet(collection.merged);
					}
				} else {
					for (const pellet of world.pellets.values()) {
						iterateAnimatedPellet(pellet);
					}
				}

				/** @type {[Cell, number][]} */
				const sorted = [];
				/** @param {Cell} cell */
				const iterateSortableCell = cell => {
					const rAlpha = Math.min(Math.max((now - cell.updated) / settings.drawDelay, 0), 1);
					const computedR = cell.or + (cell.nr - cell.or) * rAlpha;
					sorted.push([cell, computedR]);
				};
				if (sync.merge) {
					for (const collection of sync.merge.cells.values()) {
						if (collection.merged) iterateSortableCell(collection.merged);
					}
				} else {
					for (const cell of world.cells.values()) {
						iterateSortableCell(cell);
					}
				}

				// sort by smallest to biggest
				sorted.sort(([_a, ar], [_b, br]) => ar - br);
				for (const [cell] of sorted)
					draw(cell);

				if (settings.cellGlow) {
					render.upload('cells', now);
					let i = 0;
					/** @param {Cell} cell */
					const iterateCellGlow = cell => {
						if (cell.jagged) cellAlpha[i++] = 0;
						else {
							let alpha = calcAlpha(cell);
							// it looks kinda weird when cells get sucked in when being eaten
							if (cell.deadTo !== -1) alpha *= 0.25;
							cellAlpha[i++] = alpha;
						}
					};
					if (sync.merge) {
						for (const collection of sync.merge.cells.values()) {
							if (collection.merged) iterateCellGlow(collection.merged);
						}
					} else {
						for (const cell of world.cells.values()) {
							iterateCellGlow(cell);
						}
					}

					gl.bindBuffer(gl.ARRAY_BUFFER, glconf.vao[1].alphaBuffer);
					gl.bufferSubData(gl.ARRAY_BUFFER, 0, cellAlpha);
					gl.bindBuffer(gl.ARRAY_BUFFER, null);

					gl.useProgram(glconf.programs.circle);
					gl.bindVertexArray(glconf.vao[1].vao);
					gl.blendFunc(gl.SRC_ALPHA, gl.ONE);

					gl.bindBuffer(gl.UNIFORM_BUFFER, glconf.uniforms.Circle);
					gl.bufferData(gl.UNIFORM_BUFFER, new Float32Array([ 0.33, 1.5 ]), gl.STATIC_DRAW);
					gl.bindBuffer(gl.UNIFORM_BUFFER, null);

					gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, i);
					gl.bindVertexArray(glconf.vao[0].vao);
					gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
				}

				// draw tracers
				if (settings.tracer) {
					gl.useProgram(glconf.programs.tracer);

					const [x, y] = input.mouse();
					tracerUboFloats[2] = x; // tracer_pos2.x
					tracerUboFloats[3] = y; // tracer_pos2.y

					world.mine.forEach(id => {
						/** @type {Cell | undefined} */
						let cell;
						if (sync.merge) {
							cell = sync.merge.cells.get(id)?.merged;
						} else {
							cell = world.cells.get(id);
						}
						if (!cell || cell.deadAt !== undefined) return;

						let { x, y } = world.xyr(cell, undefined, now);
						tracerUboFloats[0] = x; // tracer_pos1.x
						tracerUboFloats[1] = y; // tracer_pos1.y
						gl.bindBuffer(gl.UNIFORM_BUFFER, glconf.uniforms.Tracer);
						gl.bufferSubData(gl.UNIFORM_BUFFER, 0, tracerUboBuffer);
						gl.bindBuffer(gl.UNIFORM_BUFFER, null);
						gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
					});
				}
			})();

			(function minimap() {
				if (now - lastMinimapDraw < 40) return;
				lastMinimapDraw = now;

				if (!aux.settings.showMinimap) {
					ui.minimap.canvas.style.display = 'none';
					return;
				} else {
					ui.minimap.canvas.style.display = '';
				}

				const { canvas, ctx } = ui.minimap;
				// clears the canvas
				const canvasLength = canvas.width = canvas.height = Math.ceil(200 * devicePixelRatio);
				const sectorSize = canvas.width / 5;

				// cache the background if necessary (25 texts = bad)
				if (minimapCache && minimapCache.bg.width === canvasLength
					&& minimapCache.darkTheme === aux.settings.darkTheme) {
					ctx.putImageData(minimapCache.bg, 0, 0);
				} else {
					// draw section names
					ctx.font = `${Math.floor(sectorSize / 3)}px Ubuntu`;
					ctx.fillStyle = '#fff';
					ctx.globalAlpha = aux.settings.darkTheme ? 0.3 : 0.7;
					ctx.textAlign = 'center';
					ctx.textBaseline = 'middle';

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

				const { border } = world;
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
				ctx.fillStyle = '#ff0';
				ctx.globalAlpha = 0.3;

				const sectionX = Math.floor((world.camera.x - border.l) / gameWidth * 5);
				const sectionY = Math.floor((world.camera.y - border.t) / gameHeight * 5);
				ctx.fillRect(sectionX * sectorSize, sectionY * sectorSize, sectorSize, sectorSize);

				// draw section names
				ctx.font = `${Math.floor(sectorSize / 3)}px Ubuntu`;
				ctx.fillStyle = aux.settings.darkTheme ? '#fff' : '#000';
				ctx.textAlign = 'center';
				ctx.textBaseline = 'middle';

				ctx.globalAlpha = 1;

				// draw cells
				/** @param {{ nx: number, ny: number, nr: number, Rgb: number, rGb: number, rgB: number }} cell */
				const drawCell = function drawCell(cell) {
					const x = (cell.nx - border.l) / gameWidth * canvas.width;
					const y = (cell.ny - border.t) / gameHeight * canvas.height;
					const r = Math.max(cell.nr / gameWidth * canvas.width, 2);

					ctx.scale(0.01, 0.01); // prevent sigmod from treating minimap cells as pellets
					ctx.fillStyle = aux.rgba2hex(cell.Rgb, cell.rGb, cell.rgB, 1);
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

				// draw clanmates first, below yourself
				// we sort clanmates by color AND name, to ensure clanmates stay separate
				/** @type {Map<string, { name: string, n: number, x: number, y: number }>} */
				const avgPos = new Map();
				world.clanmates.forEach(cell => {
					if (world.mine.includes(cell.id)) return;
					drawCell(cell);

					const name = cell.name || 'An unnamed cell';
					const id = ((name + cell.Rgb) + cell.rGb) + cell.rgB;
					const entry = avgPos.get(id);
					if (entry) {
						++entry.n;
						entry.x += cell.nx;
						entry.y += cell.ny;
					} else {
						avgPos.set(id, { name, n: 1, x: cell.nx, y: cell.ny });
					}
				});

				avgPos.forEach(entry => {
					drawName(entry.x / entry.n, entry.y / entry.n, entry.name);
				});

				// draw my cells above everyone else
				let myName = '';
				let ownN = 0;
				let ownX = 0;
				let ownY = 0;
				world.mine.forEach(id => {
					const cell = world.cells.get(id);
					if (!cell) return;

					drawCell(cell);
					myName = cell.name || 'An unnamed cell';
					++ownN;
					ownX += cell.nx;
					ownY += cell.ny;
				});

				if (ownN <= 0) {
					// if no cells were drawn, draw our spectate pos instead
					drawCell({
						nx: world.camera.x, ny: world.camera.y, nr: gameWidth / canvas.width * 5,
						Rgb: 1, rGb: 0.6, rgB: 0.6,
					});
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

			ui.chat.matchTheme();

			requestAnimationFrame(renderGame);
		}

		renderGame();
		return render;
	})();



	// @ts-expect-error for debugging purposes. dm me on discord @8y8x to work out stability if you need something
	window.sigfix = {
		destructor, aux, ui, settings, sync, world, net, input, glconf, render,
	};
})();
