if (typeof document === "undefined") {
	const base = "https://texlyre.github.io/texlyre-busytex/core/busytex";
	importScripts(`${base}/busytex_pipeline.js`);
	const compiler = new BusytexPipeline(
		`${base}/busytex.js`,
		`${base}/busytex.wasm`,
		[],
		[`${base}/texlive-basic.js`],
		[],
		() => {},
		() => {},
		true,
		BusytexPipeline.ScriptLoaderWorker
	);
	onmessage = async ({data}) => {
		try {
			postMessage(
				await compiler.compile(
					[{path: "main.tex", contents: data}],
					"main.tex",
					false,
					false,
					false,
					null,
					"silent",
					"pdftex_bibtex8",
					null,
					"https://texlive2026.texlyre.org"
				)
			);
		} catch (error) {
			postMessage({log: error.message});
		}
	};
} else {
	const button = document.querySelector("button");
	const editor = document.querySelector("textarea");
	const preview = document.querySelector("iframe");
	fetch("boilerplate.tex")
		.then(response => response.text())
		.then(source => editor.value = source)
		.catch(alert);
	let compiler;
	button.onclick = () => {
		button.disabled = true;
		compiler ??= new Worker("index.js");
		compiler.onerror = (error) => {
			alert(error.message);
			compiler.terminate();
			compiler = undefined;
			button.disabled = false;
		};
		compiler.onmessage = ({data}) => {
			if (data.pdf?.length) {
				URL.revokeObjectURL(preview.src);
				preview.src = URL.createObjectURL(
					new Blob(
						[data.pdf],
						{type: "application/pdf"}
					)
				);
			} else {
				alert(data.log);
			}
			button.disabled = false;
		};
		compiler.postMessage(editor.value);
	};
}
