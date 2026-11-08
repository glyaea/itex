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
	const editor = document.querySelector("textarea");
	const explorer = document.querySelector("explorer");
	const nav = document.querySelector("nav");
	const preview = document.querySelector("iframe");
	const tree = document.querySelector("ul");
	const [openFolder, createFile, createFolder, compile, remove] = nav.querySelectorAll("button");
	let compiler;
	let selected;
	let saved = "";
	openFolder.onclick = () => run(async () => {
		const directory = await showDirectoryPicker({mode: "readwrite"});
		if (!discardChanges()) return;
		const entry = await addEntry(directory, document.createElement("ul"));
		await selectEntry(entry);
		tree.replaceChildren(entry);
		for (const pane of document.querySelectorAll("[hidden]")) pane.hidden = false;
	});
	createFile.onclick = () => run(() => createEntry("getFileHandle"));
	createFolder.onclick = () => run(() => createEntry("getDirectoryHandle"));
	compile.onclick = () => run(compileDocument);
	remove.onclick = () => run(async () => {
		if (!discardChanges()) return;
		const parent = selected.parentElement.closest("li");
		await parent.handle.removeEntry(selected.handle.name, {recursive: true});
		selected.remove();
		await selectEntry(parent);
	});
	editor.oninput = () => {
		selected.firstElementChild.style.fontStyle = editor.value === saved ? "" : "italic";
	};
	document.onkeydown = event => {
		if ((event.ctrlKey || event.metaKey) && event.key === "s") {
			event.preventDefault();
			compile.click();
		}
	};
	async function run(action) {
		compile.disabled = true;
		nav.inert = true;
		explorer.inert = true;
		editor.readOnly = true;
		try {
			await action();
		} catch (error) {
			if (error.name !== "AbortError") alert(error.message);
		} finally {
			compile.disabled = editor.disabled;
			nav.inert = false;
			explorer.inert = false;
			editor.readOnly = false;
		}
	}
	async function addEntry(handle, list) {
		const entry = document.createElement("li");
		entry.handle = handle;
		const name = document.createElement("button");
		name.textContent = handle.name + (handle.kind === "directory" ? "/" : "");
		name.onclick = () => run(() => {
			if (entry !== selected && discardChanges()) return selectEntry(entry);
		});
		entry.append(name);
		list.insertBefore(entry, [...list.children].find(other => other.handle.name > handle.name) ?? null);
		if (handle.kind === "directory") {
			const children = document.createElement("ul");
			entry.append(children);
			for await (const child of handle.values()) await addEntry(child, children);
		}
		return entry;
	}
	async function selectEntry(entry) {
		const editable = entry.handle.kind === "file" && entry.handle.name.endsWith(".tex");
		const source = editable ? await (await entry.handle.getFile()).text() : "";
		selected?.firstElementChild.removeAttribute("style");
		selected = entry;
		selected.firstElementChild.style.fontWeight = "bold";
		editor.value = saved = source;
		editor.disabled = !editable;
		remove.disabled = !entry.parentElement.closest("li");
		URL.revokeObjectURL(preview.src);
		preview.removeAttribute("src");
	}
	function discardChanges() {
		return editor.value === saved || confirm("Discard changes?");
	}
	async function createEntry(method) {
		const name = prompt("Name?");
		if (!name) return;
		const directory = selected.handle.kind === "directory" ? selected : selected.parentElement.closest("li");
		const list = directory.lastElementChild;
		if ([...list.children].some(entry => entry.handle.name === name)) throw new Error("Name already exists.");
		await addEntry(await directory.handle[method](name, {create: true}), list);
	}
	async function compileDocument() {
		const file = await selected.handle.createWritable();
		await file.write(editor.value);
		await file.close();
		saved = editor.value;
		editor.oninput();
		compiler ??= new Worker("index.js");
		const data = await new Promise((resolve, reject) => {
			compiler.onmessage = ({data}) => resolve(data);
			compiler.onerror = error => {
				compiler.terminate();
				compiler = undefined;
				reject(error);
			};
			compiler.postMessage(editor.value);
		});
		if (!data.pdf?.length) throw new Error(data.log);
		URL.revokeObjectURL(preview.src);
		preview.src = URL.createObjectURL(new Blob([data.pdf], {type: "application/pdf"}));
	}
}
