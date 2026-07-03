/** An image the user showed her, for display in the message (object URL + keepsake id). */
export interface ShownImage {
	id: string;
	url: string;
}

export interface Message {
	id: string;
	role: 'user' | 'assistant' | 'system';
	content: string;
	/** Original content with [lang:xx]/[voice:xxx] control tags kept — used as API context
	 *  so the LLM sees its own tag usage and continues the pattern correctly. */
	apiContent?: string;
	timestamp: Date;
	images?: ShownImage[];
}

function createChatStore() {
	let messages = $state<Message[]>([]);
	let isLoading = $state(false);
	let error = $state<string | null>(null);
	let streamingContent = $state('');
	let errorTimeout: ReturnType<typeof setTimeout> | null = null;

	function addMessage(role: 'user' | 'assistant' | 'system', content: string, images?: ShownImage[]) {
		const message: Message = {
			id: crypto.randomUUID(),
			role,
			content,
			timestamp: new Date(),
			...(images?.length ? { images } : {})
		};
		messages = [...messages, message];
		return message;
	}

	function addSystemMessage(content: string) {
		return addMessage('system', content);
	}

	function updateLastMessage(content: string, apiContent?: string) {
		if (messages.length > 0 && messages[messages.length - 1].role === 'assistant') {
			messages = messages.map((msg, i) =>
				i === messages.length - 1 ? { ...msg, content, ...(apiContent !== undefined ? { apiContent } : {}) } : msg
			);
		}
	}

	function setLoading(loading: boolean) {
		isLoading = loading;
	}

	function setError(err: string | null) {
		// Clear any existing timeout
		if (errorTimeout) {
			clearTimeout(errorTimeout);
			errorTimeout = null;
		}
		error = err;
		// Auto-dismiss after 5 seconds if error is set
		if (err) {
			errorTimeout = setTimeout(() => {
				error = null;
				errorTimeout = null;
			}, 5000);
		}
	}

	function dismissError() {
		if (errorTimeout) {
			clearTimeout(errorTimeout);
			errorTimeout = null;
		}
		error = null;
	}

	function setStreamingContent(content: string) {
		streamingContent = content;
	}

	function removeLastMessage() {
		if (messages.length > 0) {
			messages = messages.slice(0, -1);
		}
	}

	function clearMessages() {
		messages = [];
	}

	return {
		get messages() {
			return messages;
		},
		get isLoading() {
			return isLoading;
		},
		get error() {
			return error;
		},
		get streamingContent() {
			return streamingContent;
		},
		addMessage,
		addSystemMessage,
		updateLastMessage,
		setLoading,
		setError,
		dismissError,
		setStreamingContent,
		removeLastMessage,
		clearMessages
	};
}

export const chatStore = createChatStore();
