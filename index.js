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
	const [openFolder, createFile, createFolder, remove, write] = nav.querySelectorAll("button");
	let compiler;
	let selected;
	let saved = "";
	let tree;
	openFolder.onclick = () => run(async () => {
		const directory = await showDirectoryPicker({mode: "readwrite"});
		if (!discardChanges()) return;
		const replacement = new VanillaTree(document.createElement("explorer"));
		const id = await addEntry(replacement, directory);
		tree?.destroy();
		tree = replacement;
		tree.container = explorer;
		explorer.append(tree.tree);
		await selectEntry(id);
		tree.open(id);
		for (const pane of document.querySelectorAll("[hidden]")) pane.hidden = false;
	});
	createFile.onclick = () => run(() => createEntry("getFileHandle"));
	createFolder.onclick = () => run(() => createEntry("getDirectoryHandle"));
	write.onclick = () => run(writeDocument);
	remove.onclick = () => run(async () => {
		if (!discardChanges()) return;
		const parent = tree.getParent(selected);
		await tree.leafs[parent].handle.removeEntry(tree.leafs[selected].handle.name, {recursive: true});
		tree.remove(selected);
		await selectEntry(parent);
	});
	explorer.addEventListener("vtree-select", ({detail: {id}}) => {
		if (id !== selected) run(async () => {
			if (discardChanges()) await selectEntry(id);
		}).then(() => tree.select(selected));
	});
	editor.oninput = () => {
		tree.getLeaf(selected).querySelector("a").style.fontStyle = editor.value === saved ? "" : "italic";
	};
	document.onkeydown = event => {
		if ((event.ctrlKey || event.metaKey) && event.key === "s") {
			event.preventDefault();
			write.click();
		}
	};
	async function run(action) {
		write.disabled = true;
		nav.inert = true;
		explorer.inert = true;
		editor.readOnly = true;
		try {
			await action();
		} catch (error) {
			if (error.name !== "AbortError") alert(error.message);
		} finally {
			write.disabled = editor.disabled;
			nav.inert = false;
			explorer.inert = false;
			editor.readOnly = false;
		}
	}
	async function addEntry(tree, handle, parent) {
		const id = parent ? `${parent}/${handle.name}` : handle.name;
		tree.add({id, label: handle.name + (handle.kind === "directory" ? "/" : ""), parent, handle});
		const entry = tree.getLeaf(id);
		const list = entry.parentElement;
		list.insertBefore(entry, [...list.children].find(other => tree.leafs[other.dataset.vtreeId].handle.name > handle.name) ?? null);
		if (handle.kind === "directory") {
			for await (const child of handle.values()) await addEntry(tree, child, id);
		}
		return id;
	}
	async function selectEntry(id) {
		const handle = tree.leafs[id].handle;
		const editable = handle.kind === "file" && handle.name.endsWith(".tex");
		const source = editable ? await (await handle.getFile()).text() : "";
		tree.getLeaf(selected, true)?.querySelector("a").removeAttribute("style");
		selected = id;
		editor.value = saved = source;
		editor.disabled = !editable;
		remove.disabled = tree.getParent(id) === null;
		tree.select(id);
		URL.revokeObjectURL(preview.src);
		preview.removeAttribute("src");
	}
	function discardChanges() {
		return editor.value === saved || confirm("Discard changes?");
	}
	async function createEntry(method) {
		const name = prompt("Name?");
		if (!name) return;
		const directory = tree.leafs[selected].handle.kind === "directory" ? selected : tree.getParent(selected);
		if (tree.leafs[`${directory}/${name}`]) throw new Error("Name already exists.");
		await addEntry(tree, await tree.leafs[directory].handle[method](name, {create: true}), directory);
		tree.open(directory);
	}
	async function writeDocument() {
		const source = tree.leafs[selected].handle;
		const file = await source.createWritable();
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
		const directory = tree.getParent(selected);
		const pdf = await tree.leafs[directory].handle.getFileHandle(source.name.replace(/\.tex$/, ".pdf"), {create: true});
		const output = await pdf.createWritable();
		await output.write(data.pdf);
		await output.close();
		if (!tree.leafs[`${directory}/${pdf.name}`]) await addEntry(tree, pdf, directory);
		URL.revokeObjectURL(preview.src);
		preview.src = URL.createObjectURL(await pdf.getFile());
	}
}
