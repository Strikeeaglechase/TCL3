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

enum CompletionItemKind {
	Method = 2,
	Function = 3,
	Variable = 6
}

export { TextDocumentSyncKind, SemanticTokenTypes, CompletionItemKind };
