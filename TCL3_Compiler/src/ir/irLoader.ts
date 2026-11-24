import { IRArgument, IRArgumentType, IRCodeLine, IRLabelLine, IROpCode, IRProgram } from "./ir.js";

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

		const match = line.match(/(?:(\w+) ([A-Z_]+\(.+?\)(?::\d)?) ?([A-Z_]+\(.+?\)(?::\d)?)? ?([A-Z_]+\(.+?\)(?::\d)?)?)|HALT/);
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
		const [_, strIdx, strValue] = s.match(/(\d+): (.+)/);
		return strValue;
	});

	strings.forEach(str => {
		program.strings.push(str);
	});

	return program;
}

function parseIrArgument(arg: string): IRArgument {
	const match = arg.match(/(\w+)\((.+?)\)(?::(\d))?/);
	const [_, rawType, value, size] = match;
	const type = Object.values(IRArgumentType).find(argumentType => argumentType === rawType);
	if (!type) throw new Error(`Invalid IR argument type: ${rawType}`);

	if (type == IRArgumentType.MEM_REG && (value.includes("-") || value.includes("+"))) {
		const offsetMatch = value.match(/(.+?)([+-]\d+)/);
		if (!offsetMatch) throw new Error(`Invalid MEM_REG argument: ${arg}`);
		const [_, regValue, offset] = offsetMatch;
		return new IRArgument(type, regValue, parseInt(size), parseInt(offset));
	}

	const sizeValue = size ? parseInt(size) : undefined;
	return new IRArgument(type, value, sizeValue);
}

function compareIrPrograms(prog1: IRProgram, prog2: IRProgram) {
	const prog1Code = prog1.code.filter(line => line instanceof IRCodeLine || line instanceof IRLabelLine);
	const prog2Code = prog2.code.filter(line => line instanceof IRCodeLine || line instanceof IRLabelLine);

	if (prog1Code.length != prog2Code.length) {
		console.log(`Code length mismatch: ${prog1Code} vs ${prog2Code}`);
	}

	prog1Code.forEach((line, idx) => {
		const otherLine = prog2Code[idx];
		if (line.constructor.name != otherLine.constructor.name) {
			console.log(`Line ${idx} type mismatch: ${line.constructor.name} vs ${otherLine.constructor.name}`);
			return;
		}

		if (line instanceof IRLabelLine) {
			if (line.label != (otherLine as IRLabelLine).label) {
				console.log(`Line ${idx} label mismatch: ${line.label} vs ${(otherLine as IRLabelLine).label}`);
				return;
			}
		}

		if (!(line instanceof IRCodeLine)) return;
		const otherCodeLine = otherLine as IRCodeLine;

		if (line.opcode != otherCodeLine.opcode) {
			console.log(`Line ${idx} opcode mismatch: ${line.opcode} vs ${otherCodeLine.opcode}`);
			return;
		}

		if (line.args.length != otherCodeLine.args.length) {
			console.log(`Line ${idx} args length mismatch: ${line.args.length} vs ${otherCodeLine.args.length}`);
			return;
		}

		line.args.forEach((arg, argIdx) => {
			const otherArg = otherCodeLine.args[argIdx];
			if (!arg.equals(otherArg)) {
				console.log(`Line ${idx} arg ${argIdx} mismatch: ${arg.toString()} vs ${otherArg.toString()}`);
			}
		});
	});
}

export { loadIrFromFile, compareIrPrograms };
