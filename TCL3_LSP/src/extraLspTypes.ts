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

export { TextDocumentSyncKind, SemanticTokenTypes, SemanticTokenModifiers, CompletionItemKind };
