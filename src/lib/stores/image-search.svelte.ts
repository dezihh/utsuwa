import type { ImageSearchResult } from '$lib/utils/image-search'

let results = $state<ImageSearchResult[]>([])
let isOpen = $state(false)
let currentQuery = $state('')
let isLoading = $state(false)
let error = $state<string | null>(null)

export function openModal(newResults: ImageSearchResult[], query: string) {
	results = newResults
	currentQuery = query
	isOpen = true
	error = null
}

export function closeModal() {
	isOpen = false
}

export function setLoading(loading: boolean) {
	isLoading = loading
}

export function setError(err: string | null) {
	error = err
}

export const imageSearchStore = {
	get results() {
		return results
	},
	get isOpen() {
		return isOpen
	},
	get currentQuery() {
		return currentQuery
	},
	get isLoading() {
		return isLoading
	},
	get error() {
		return error
	},
	openModal,
	closeModal,
	setLoading,
	setError
}
