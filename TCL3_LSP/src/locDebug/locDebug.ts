/*
import { Linker } from "tlc3/linker/linker.js";
import { AST } from "tlc3/parser/ast.js";
import { walk } from "tlc3/parser/walker.js";

import { Analyzer } from "../analyzer.js";
import { SemanticTokenTypes } from "../extraLspTypes.js";
import { ColorValue, Renderer } from "./renderer/index.js";

const colors: ColorValue[] = [
	[35, 57, 91],
	[91, 141, 239],
	[118, 199, 232],
	[42, 157, 143],
	[123, 205, 186],
	[145, 181, 139],
	[168, 173, 101],
	[233, 180, 76],
	[242, 166, 90],
	[232, 121, 107],
	[217, 108, 138],
	[184, 76, 112],
	[167, 139, 206],
	[115, 90, 158],
	[101, 120, 137]
];

const sourceCode = `struct Point {
	x: int;
	y: int;

	fn "+"(other: Point): Point {
		let result: Point = {x: this->x + other.x, y: this->y + other.y};
		return result;
	}

	fn "+"(other: int): Point {
		let result: Point = {x: this->x + other, y: this->y + other};
		return result;
	}

	fn "+"(other: Point*): Point {
		let result: Point = {x: this->x + other->x, y: this->y + other->y};
		return result;
	}

	// ISS-006
	fn "[]"(index: int): int {
		if (index == 0) return this->x;
		return this->y;
	}
}

fn main(): void {
	let a: Point = {x: 1, y: 2};
	let b: Point = {x: 3, y: 4};

	// Goober
 	let c: Point = a + b;
	out c.x;

	let d = a + 5;
	out d.y;

	let e: Point* = &a;
	let f: Point = b + e;
	out f.x;

	out (a + b).x + 2;

	let indexed: Point = {x: 8, y: 9};
	out indexed[0];
	out indexed[1];
	// ISS-031
	let inferredIndexResult = indexed[1];
	out inferredIndexResult;
}`;

const renderer = new Renderer("render-target");
function init() {
	renderer.resize(window.innerWidth, window.innerHeight + 1);

	window.addEventListener("resize", () => {
		renderer.resize(window.innerWidth, window.innerHeight + 1);
	});

	run();
}

const tokenTypeColors = {
	[SemanticTokenTypes.type]: colors[0],
	[SemanticTokenTypes.class]: colors[1],
	[SemanticTokenTypes.parameter]: colors[2],
	[SemanticTokenTypes.variable]: colors[3],
	[SemanticTokenTypes.property]: colors[4],
	[SemanticTokenTypes.function]: colors[5],
	[SemanticTokenTypes.method]: colors[6],
	[SemanticTokenTypes.keyword]: colors[7],
	[SemanticTokenTypes.comment]: colors[8],
	[SemanticTokenTypes.string]: colors[9],
	[SemanticTokenTypes.number]: colors[10]
};

function run() {
	// requestAnimationFrame(run);
	renderer.clear(0);

	const linker = new Linker(`C:/test.tcl3`, {
		readFile: () => sourceCode
	});
	const analyzer = new Analyzer(`C:/test.tcl3`, () => sourceCode);
	const tokenRanges = analyzer.tokenTypeRanges;

	const program = linker.link();
	const flatAst: AST[] = [];
	walk(program, node => flatAst.push(node));

	const nodeTypes: string[] = [];
	flatAst.forEach(node => {
		if (!nodeTypes.includes(node.type)) {
			nodeTypes.push(node.type);
		}
	});

	let x = 25;
	let y = 25;

	const xSpace = 10;
	const ySpace = 20;

	const indexToPosition = (idx: number) => {
		const line = sourceCode.substring(0, idx).split("\n");
		const lineNum = line.length - 1;
		const colNum = line[lineNum].length;

		return {
			x: 25 + colNum * xSpace,
			y: 25 + lineNum * ySpace
		};
	};

	flatAst.forEach(node => {
		if (!node.location) return;
		const start = indexToPosition(node.location.startIndex);
		const end = indexToPosition(node.location.endIndex);

		const color = colors[nodeTypes.indexOf(node.type) % colors.length];
		// renderer.strokeRect(start.x, start.y - ySpace, end.x - start.x, end.y - start.y + ySpace + 5, color);
	});

	for (let i = 0; i < sourceCode.length; i++) {
		let color: ColorValue = [255, 255, 255];
		const range = tokenRanges.find(range => i >= range.start && i < range.end);
		if (range) {
			color = tokenTypeColors[range.type];
		} else {
			color = [255, 0, 0];
		}

		renderer.text(sourceCode[i], x, y, color, 14);
		x += xSpace;
		if (sourceCode[i] == "\n") {
			x = 25;
			y += ySpace;
		}
	}

	for (let i = 0; i < nodeTypes.length; i++) {
		const color = colors[i % colors.length];
		renderer.text(nodeTypes[i], renderer.width - 250, 25 + i * 25, color, 14);
	}

	for (let i = 0; i < Object.keys(SemanticTokenTypes).length; i++) {
		const tokenType = Object.keys(SemanticTokenTypes)[i];
		const color = tokenTypeColors[SemanticTokenTypes[tokenType as keyof typeof SemanticTokenTypes]];

		renderer.text(tokenType, renderer.width - 250, 100 + (i + nodeTypes.length) * 25, color, 14);
	}
}

init();

*/
