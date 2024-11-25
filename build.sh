# ensure compatibility with chrome 57 (first version to support WebAssembly)
wat2wasm sigmally-fixes.wat \
	--disable-mutable-globals \
	--disable-saturating-float-to-int \
	--disable-sign-extension \
	--disable-simd \
	--disable-multi-value \
	--disable-bulk-memory \
	--disable-reference-types \
	--output=- | base64 > b64-wasm.txt
