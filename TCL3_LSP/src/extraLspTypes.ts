enum TextDocumentSyncKind {
	None = 0,
	Full = 1,
	Incremental = 2
}

enum SemanticTokenTypes {
	type = "type",
	class = "class",
	parameter = "parameter",
	variable = "variable",
	property = "property",
	function = "function",
	method = "method",
	keyword = "keyword",
	comment = "comment",
	string = "string",
	number = "number"
}

enum SemanticTokenModifiers {
	declaration = "declaration",
	definition = "definition",
	readonly = "readonly",
	static = "static",
	deprecated = "deprecated",
	abstract = "abstract",
	async = "async",
	modification = "modification",
	documentation = "documentation",
	defaultLibrary = "defaultLibrary"
}

enum CompletionItemKind {
	Method = 2,
	Function = 3,
	Variable = 6
}

enum SymbolKind {
	File = 1,
	Module = 2,
	Namespace = 3,
	Package = 4,
	Class = 5,
	Method = 6,
	Property = 7,
	Field = 8,
	Constructor = 9,
	Enum = 10,
	Interface = 11,
	Function = 12,
	Variable = 13,
	Constant = 14,
	String = 15,
	Number = 16,
	Boolean = 17,
	Array = 18,
	Object = 19,
	Key = 20,
	Null = 21,
	EnumMember = 22,
	Struct = 23,
	Event = 24,
	Operator = 25,
	TypeParameter = 26
}

export { TextDocumentSyncKind, SemanticTokenTypes, SemanticTokenModifiers, CompletionItemKind, SymbolKind };
