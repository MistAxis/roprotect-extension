<script lang="ts">
	import { untrack } from 'svelte';
	import { _ } from 'svelte-i18n';
	import {
		File as FileIcon,
		FileText,
		Image as ImageIcon,
		Trash2,
		Upload,
		X
	} from '@lucide/svelte';
	import StatusIcon from '@/components/icons/StatusIcon.svelte';
	import Select from '@/components/ui/Select.svelte';
	import type { StatusIconName } from '@/lib/utils/icon-mapping';
	import PascMarkdownEditor from './PascMarkdownEditor.svelte';
	import { apiClient } from '@/lib/services/rotector/api-client';
	import type { UserStatus } from '@/lib/types/api';
	import { pascFileKind } from '@/lib/utils/status/pasc-record';
	import { PASC_FILE_LIMITS } from '@/lib/types/constants';
	import { trapFocus } from '@/lib/utils/dom/focus-trap';
	import {
		PASC_ACCESS_RANK,
		PASC_FLAG_LABELS,
		PASC_FLAG_TO_NUMERIC,
		type PascAccessLevel,
		type PascCaseFile,
		type PascFlag,
		type PascRecord
	} from '@/lib/data/pasc';

	// PASC record editing window. Renders inside the shared modal shell. Save
	// upserts through the RoProtect proxy; file attach uploads through it too.

	interface Props {
		record: PascRecord;
		mode?: 'edit' | 'create';
		onClose: () => void;
		onSaved?: ((status: UserStatus) => void) | undefined;
		onRefresh?: (() => void) | undefined;
	}

	let { record, mode = 'edit', onClose, onSaved, onRefresh }: Props = $props();

	const FLAGS: PascFlag[] = [
		'safe',
		'provisional',
		'past_offender',
		'mixed',
		'unsafe',
		'flagged',
		'queued',
		'redacted'
	];
	const FLAG_ICONS: Record<PascFlag, StatusIconName> = {
		safe: 'safe',
		provisional: 'provisional',
		past_offender: 'past-offender',
		mixed: 'mixed',
		unsafe: 'unsafe',
		flagged: 'pending',
		queued: 'queued',
		redacted: 'redacted',
		unknown: 'unknown'
	};
	const FLAG_COLORS: Record<PascFlag, string> = {
		safe: 'var(--color-success)',
		provisional: 'var(--color-status-safe)',
		past_offender: 'var(--color-status-past-offender)',
		mixed: 'var(--color-status-mixed)',
		unsafe: 'var(--color-status-unsafe)',
		flagged: 'var(--color-status-pending)',
		queued: 'var(--color-status-queued)',
		redacted: 'var(--color-status-error)',
		unknown: 'var(--color-status-pending)'
	};
	const LEVELS = Object.keys(PASC_ACCESS_RANK) as PascAccessLevel[];
	const LEVEL_OPTIONS = LEVELS.map((level) => ({ value: level, label: `${level}+` }));
	const FILE_LEVEL_OPTIONS = LEVELS.map((level) => ({ value: level, label: level }));

	let flag = $state<PascFlag>(untrack(() => record.flag));
	let publicNote = $state(untrack(() => record.publicNote));
	// Two independent fields: who may open the record at all, and who may read
	// its public note. The internal floor has no server field (always M1+).
	let recordLevel = $state<PascAccessLevel>(untrack(() => record.accessLevel ?? 'A2'));
	let publicNoteLevel = $state<PascAccessLevel>(untrack(() => record.accessLevel ?? 'A2'));
	let internalReview = $state(untrack(() => record.internalReview));

	// Snapshot for the dirty check so closing cannot silently discard edits.
	const initial = untrack(() => ({
		flag: record.flag,
		publicNote: record.publicNote,
		recordLevel: record.accessLevel ?? 'A2',
		publicNoteLevel: record.accessLevel ?? 'A2',
		internalReview: record.internalReview
	}));

	let saving = $state(false);
	let saveError = $state<string | null>(null);
	let uploading = $state(false);
	let uploadProgress = $state<{ current: number; total: number } | null>(null);
	let uploadError = $state<string | null>(null);
	let confirmingDeleteId = $state<string | null>(null);
	let deletingFile = $state(false);
	let deleteError = $state<string | null>(null);
	let newFileLevel = $state<PascAccessLevel>(
		untrack(() => record.accessLevel ?? record.internalReviewMinLevel)
	);
	let extraFiles = $state<PascCaseFile[]>([]);
	let fileInput = $state<HTMLInputElement | null>(null);
	let showDiscardConfirm = $state(false);

	const title = $derived(
		$_(mode === 'create' ? 'pasc_edit_title_create' : 'pasc_edit_title_edit', {
			values: { 0: record.userId }
		})
	);

	const dirty = $derived(
		flag !== initial.flag ||
			publicNote !== initial.publicNote ||
			recordLevel !== initial.recordLevel ||
			publicNoteLevel !== initial.publicNoteLevel ||
			internalReview !== initial.internalReview ||
			extraFiles.length > 0
	);

	const FILE_KIND_KEYS: Record<PascCaseFile['kind'], string> = {
		markdown: 'pasc_file_kind_markdown',
		image: 'pasc_file_kind_image',
		other: 'pasc_file_kind_other'
	};

	// The lookup refresh after an upload returns the new file too. Merge both
	// sources and keep the first copy per upstream id (or name for legacy
	// entries without one) so a refresh can never duplicate a row.
	const allFiles = $derived.by(() => {
		const seen: string[] = [];
		const merged: PascCaseFile[] = [];
		for (const file of [...record.files, ...extraFiles]) {
			const key = file.fileId ? `id:${file.fileId}` : `name:${file.name.toLowerCase()}`;
			if (seen.includes(key)) continue;
			seen.push(key);
			merged.push(file);
		}
		return merged;
	});

	const uploadLabel = $derived(
		uploadProgress
			? $_('pasc_file_uploading', {
					values: {
						0: String(uploadProgress.current),
						1: String(uploadProgress.total)
					}
				})
			: $_('pasc_file_attach')
	);

	// Once the refreshed record owns an upload, drop the local pending copy.
	// Otherwise deleting the stored file would make the pending row reappear.
	$effect(() => {
		const storedIds = new Set(
			record.files.map((file) => file.fileId).filter((fileId): fileId is string => fileId !== null)
		);
		if (storedIds.size === 0 || extraFiles.length === 0) return;
		const remaining = extraFiles.filter(
			(file) => file.fileId === null || !storedIds.has(file.fileId)
		);
		if (remaining.length !== extraFiles.length) extraFiles = remaining;
	});

	function formatSize(bytes: number | null): string {
		if (bytes === null) return '';
		if (bytes < 1024) return `${String(bytes)} B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
		return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	}

	function attemptClose(): void {
		if (dirty) {
			showDiscardConfirm = true;
			return;
		}
		onClose();
	}

	async function save() {
		if (saving) return;
		saving = true;
		saveError = null;
		try {
			// Only flag is validated proxy-side; the rest passes through to the
			// PASC record schema verbatim. internalReview has no configurable
			// visibility (the floor is always M1+), so no level is sent for it.
			const status = await apiClient.upsertPascRecord(record.userId, {
				flag: PASC_FLAG_TO_NUMERIC[flag],
				accessLevel: recordLevel,
				publicNote,
				publicNoteLevel,
				internalReview
			});
			onSaved?.(status);
		} catch (error) {
			saveError = error instanceof Error ? error.message : String(error);
		} finally {
			saving = false;
		}
	}

	async function handleFilesSelected(event: Event) {
		const input = event.currentTarget;
		if (!(input instanceof HTMLInputElement) || !input.files) return;
		const selected = [...input.files];
		input.value = '';
		if (selected.length === 0 || uploading) return;
		uploading = true;
		uploadError = null;
		const uploaded: PascCaseFile[] = [];
		const errors: string[] = [];

		if (selected.length > PASC_FILE_LIMITS.MAX_FILES - allFiles.length) {
			uploadError = $_('pasc_file_error_count_total', {
				values: { 0: String(PASC_FILE_LIMITS.MAX_FILES) }
			});
			uploading = false;
			return;
		}

		// Enforce size before reading anything into memory.
		const accepted: File[] = [];
		let totalBytes = 0;
		for (const file of selected) {
			if (file.size > PASC_FILE_LIMITS.MAX_BYTES) {
				errors.push(
					$_('pasc_file_error_too_large', {
						values: { 0: file.name, 1: formatSize(PASC_FILE_LIMITS.MAX_BYTES) }
					})
				);
				continue;
			}
			totalBytes += file.size;
			if (totalBytes > PASC_FILE_LIMITS.MAX_TOTAL_BYTES) {
				errors.push(
					$_('pasc_file_error_total', {
						values: { 0: formatSize(PASC_FILE_LIMITS.MAX_TOTAL_BYTES) }
					})
				);
				break;
			}
			accepted.push(file);
		}

		try {
			for (const [index, file] of accepted.entries()) {
				uploadProgress = { current: index + 1, total: accepted.length };
				try {
					const bytes = await file.arrayBuffer();
					const descriptor = await apiClient.uploadPascFile(
						record.userId,
						file.name,
						bytes,
						file.type || undefined,
						newFileLevel
					);
					const name = descriptor.name ?? file.name;
					if (
						descriptor.fileId &&
						(record.files.some((entry) => entry.fileId === descriptor.fileId) ||
							extraFiles.some((entry) => entry.fileId === descriptor.fileId) ||
							uploaded.some((entry) => entry.fileId === descriptor.fileId))
					) {
						continue;
					}
					uploaded.push({
						id: `upload:${descriptor.fileId}`,
						name,
						kind: pascFileKind(name),
						accessLevel: newFileLevel,
						sizeLabel: formatSize(descriptor.size),
						fileId: descriptor.fileId
					});
				} catch (error) {
					errors.push(`${file.name}: ${error instanceof Error ? error.message : String(error)}`);
				}
			}
			if (uploaded.length > 0) {
				extraFiles = [...extraFiles, ...uploaded];
				onRefresh?.();
			}
			if (errors.length > 0) {
				const firstError = errors[0] ?? $_('pasc_file_error_generic');
				uploadError =
					errors.length === 1
						? firstError
						: `${firstError} ${$_('pasc_file_error_more', {
								values: { 0: String(errors.length - 1) }
							})}`;
			}
		} finally {
			uploading = false;
			uploadProgress = null;
		}
	}

	// The modal only opens for M1+ viewers, so every delete button here is
	// inherently clearance-gated. Stored files refresh from the lookup;
	// just-uploaded extras splice out locally.
	async function deleteModalFile(file: PascCaseFile) {
		if (!file.fileId || deletingFile) return;
		if (confirmingDeleteId !== file.id) {
			confirmingDeleteId = file.id;
			return;
		}
		const fileId = file.fileId;
		confirmingDeleteId = null;
		deletingFile = true;
		deleteError = null;
		try {
			await apiClient.deletePascFile(record.userId, fileId);
			extraFiles = extraFiles.filter((entry) => entry.id !== file.id && entry.fileId !== fileId);
			onRefresh?.();
		} catch (error) {
			deleteError = error instanceof Error ? error.message : String(error);
		} finally {
			deletingFile = false;
		}
	}
</script>

<div
	class="modal-popup modal-popup-wide"
	aria-label={title}
	aria-modal="true"
	onkeydown={(event) => {
		// Keep host-page and tooltip shortcuts (Space/Enter activation, dismiss
		// keys) from swallowing keystrokes typed into the modal's editors.
		if (event.key === 'Escape') {
			event.preventDefault();
			attemptClose();
		}
		event.stopPropagation();
	}}
	role="dialog"
	tabindex="-1"
	use:trapFocus
>
	<div class="modal-header">
		<h3 class="modal-title">{title}</h3>
		<button
			class="modal-close"
			aria-label={$_('pasc_modal_close')}
			onclick={attemptClose}
			type="button"
		>
			<X size={16} />
		</button>
	</div>
	<div style:padding="0 1.125rem" class="pasc-container pasc-modal-body">
		<div class="pasc-field">
			<span class="pasc-field-label">{$_('pasc_edit_flag')}</span>
			<div class="pasc-flag-options" aria-label={$_('pasc_edit_flag')} role="radiogroup">
				{#each FLAGS as option (option)}
					<button
						class="pasc-flag-option"
						class:selected={flag === option}
						aria-pressed={flag === option}
						onclick={() => (flag = option)}
						type="button"
					>
						<StatusIcon name={FLAG_ICONS[option]} color={FLAG_COLORS[option]} size={13} />
						{$_(PASC_FLAG_LABELS[option])}
					</button>
				{/each}
			</div>
		</div>
		<div class="pasc-field">
			<div class="pasc-field-row">
				<span class="pasc-field-label">{$_('pasc_edit_record_visibility')}</span>
				<Select
					ariaLabel={$_('pasc_edit_record_visibility')}
					options={LEVEL_OPTIONS}
					bind:value={recordLevel}
				/>
			</div>
		</div>
		<div class="pasc-field">
			<div class="pasc-field-row">
				<span class="pasc-field-label">{$_('pasc_edit_public_note')}</span>
				<span class="pasc-meta">{$_('pasc_edit_visible_to')}</span>
				<Select
					ariaLabel={$_('pasc_edit_public_note_visibility')}
					options={LEVEL_OPTIONS}
					bind:value={publicNoteLevel}
				/>
			</div>
			<textarea
				class="pasc-textarea"
				aria-label={$_('pasc_edit_public_note')}
				rows="3"
				bind:value={publicNote}
			></textarea>
		</div>
		<div class="pasc-field">
			<div class="pasc-field-row">
				<span class="pasc-field-label">{$_('pasc_edit_internal_review')}</span>
				<span class="pasc-meta">{$_('pasc_edit_internal_visibility')}</span>
			</div>
			<PascMarkdownEditor bind:value={internalReview} />
		</div>
		<div class="pasc-field">
			<div class="pasc-field-row">
				<span class="pasc-field-label">{$_('pasc_edit_case_files')}</span>
				<span class="pasc-file-count">{allFiles.length}</span>
			</div>

			<div class="pasc-upload">
				<div class="pasc-upload-row">
					<span class="pasc-file-level-label">{$_('pasc_edit_new_files_visible')}</span>
					<Select
						ariaLabel={$_('pasc_edit_new_files_visible')}
						disabled={uploading}
						options={FILE_LEVEL_OPTIONS}
						bind:value={newFileLevel}
					/>
					<button
						class="pasc-edit-button ms-auto"
						disabled={uploading}
						onclick={() => fileInput?.click()}
						type="button"
					>
						<Upload size={13} />
						{uploadLabel}
					</button>
				</div>
				<span class="pasc-upload-hint">{$_('pasc_edit_upload_hint')}</span>
			</div>

			{#if allFiles.length > 0}
				<div class="pasc-file-list">
					{#each allFiles as file (file.id)}
						<div class="pasc-file-manage-row">
							<span class="pasc-file-kind" aria-hidden="true">
								{#if file.kind === 'image'}
									<ImageIcon size={13} />
								{:else if file.kind === 'markdown'}
									<FileText size={13} />
								{:else}
									<FileIcon size={13} />
								{/if}
							</span>
							<span class="pasc-file-name" title={file.name}>{file.name}</span>
							<span class="pasc-file-meta">
								{$_(FILE_KIND_KEYS[file.kind])}{file.sizeLabel ? ` · ${file.sizeLabel}` : ''}
							</span>
							<span class="pasc-file-level" title={$_('pasc_edit_file_level_hint')}>
								{file.accessLevel}
							</span>
							{#if file.fileId}
								<button
									class="pasc-file-delete"
									aria-label={confirmingDeleteId === file.id
										? $_('pasc_file_confirm_delete_aria', { values: { 0: file.name } })
										: $_('pasc_file_delete_aria', { values: { 0: file.name } })}
									disabled={deletingFile}
									onclick={() => void deleteModalFile(file)}
									title={confirmingDeleteId === file.id
										? $_('pasc_file_confirm_delete_title')
										: $_('pasc_file_delete_title')}
									type="button"
								>
									<Trash2 size={12} />
									{confirmingDeleteId === file.id ? $_('pasc_file_sure') : $_('pasc_file_delete')}
								</button>
							{/if}
						</div>
					{/each}
				</div>
			{:else}
				<p class="pasc-file-empty">{$_('pasc_edit_no_files')}</p>
			{/if}

			<input
				bind:this={fileInput}
				class="hidden"
				accept=".md,.markdown,.txt,.png,.jpg,.jpeg,.gif,.webp,.bmp,.avif,.svg"
				multiple
				onchange={handleFilesSelected}
				type="file"
			/>
			{#if uploadError}
				<p class="pasc-file-error">{uploadError}</p>
			{/if}
			{#if deleteError}
				<p class="pasc-file-error">{deleteError}</p>
			{/if}
		</div>
		{#if saveError}
			<p class="pasc-meta">{saveError}</p>
		{/if}
		{#if showDiscardConfirm}
			<div class="pasc-modal-actions">
				<span class="pasc-meta">{$_('pasc_edit_discard_message')}</span>
				<button class="pasc-edit-button" onclick={() => (showDiscardConfirm = false)} type="button">
					{$_('pasc_edit_discard_cancel')}
				</button>
				<button class="pasc-edit-button" onclick={onClose} type="button">
					{$_('pasc_edit_discard_confirm')}
				</button>
			</div>
		{:else}
			<div class="pasc-modal-actions">
				<button class="pasc-edit-button" onclick={attemptClose} type="button">
					{$_('pasc_modal_cancel')}
				</button>
				<button class="pasc-edit-button" disabled={saving} onclick={save} type="button">
					{saving ? $_('pasc_edit_saving') : $_('pasc_edit_save')}
				</button>
			</div>
		{/if}
	</div>
</div>
