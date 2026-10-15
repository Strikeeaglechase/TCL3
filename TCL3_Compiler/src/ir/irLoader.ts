import { IRArgument, IRCodeLine, IRLabelLine, IROpCode, IRProgram } from "./ir.js";

function loadIrFromFile(content: string): IRProgram {
	const match = content.match(/CODE:([\w\W\n]*)STRINGS:([\w\W\n]*)/);
	const [, codeSection, stringsSection] = match;

	const lines = codeSection
		.split("\n")
		.map(l => l.trim())
		.filter(l => l.length > 0);

	const program: IRProgram = {
		code: [],
		strings: []
	};

	lines.forEach(line => {
		line = line.replace(/\d{3}: /, "").trim(); // Remove line numbers
		if (line.startsWith("#")) return; // Skip comment lines
		if (line.startsWith("?")) {
			// Insert inspect instruction
			program.code.push(new IRCodeLine("INSPECT"));
			return;
		}

		if (line.startsWith("!")) {
			program.code.push(new IRCodeLine("INSPECT"));
			program.code.push(new IRCodeLine("HALT"));
		}

		if (line.startsWith(":")) {
			program.code.push(new IRLabelLine(line.slice(1)));
			return;
		}

		const match = line.match(/(?:(\w+) ([A-Z_]+\(.+?\)) ?([A-Z_]+\(.+?\))? ?([A-Z_]+\(.+?\))?)|HALT/);
		if (!match) return;
		const [, matchedOpCode, arg1, arg2, arg3, haltMatch] = match;
		const args = [arg1, arg2, arg3].filter(a => a !== undefined).map(a => parseIrArgument(a.trim()));

		const opcode = matchedOpCode ? (matchedOpCode as IROpCode) : "HALT";
		program.code.push(new IRCodeLine(opcode, ...args));
	});

	const stringLines = stringsSection
		.split("\n")
		.map(s => s.trim())
		.filter(s => s.length > 0);
	const strings = stringLines.map(s => {
		const [_, strIdx, strValue] = s.match(/(\d+): "(.+)"/);
		return strValue;
	});

	strings.forEach(str => {
		program.strings.push(str);
	});

	return program;
}

function parseIrArgument(arg: string): IRArgument {
	const match = arg.match(/(\w+)\((.+?)\)/);
	const [_, type, value] = match;

	if (type == "MEM_REG" && (value.includes("-") || value.includes("+"))) {
		const offsetMatch = value.match(/(.+?)([+-]\d+)/);
		if (!offsetMatch) throw new Error(`Invalid MEM_REG argument: ${arg}`);
		const [_, regValue, offset] = offsetMatch;
		return new IRArgument(type as any, regValue, parseInt(offset));
	}

	return new IRArgument(type as any, value);
}

export { loadIrFromFile };
