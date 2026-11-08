import * as v from 'valibot';

// Backend strings are untrusted response data. A 2 KB element cap keeps a
// hostile or buggy server from pushing megabytes into storage or the DOM.
export const MAX_REMOTE_STRING_LENGTH = 2048;
export const MAX_REMOTE_ARRAY_ITEMS = 100;

const RemoteString = v.pipe(v.string(), v.maxLength(MAX_REMOTE_STRING_LENGTH));

// Backend nullable string normalized to undefined so consumers can use `?.` and `||` ergonomically
export const NullableString = v.pipe(
	v.nullable(RemoteString),
	v.transform((value) => value ?? undefined)
);

// Backend nullable string array normalized to undefined for the same reason
export const NullableStringArray = v.pipe(
	v.nullable(v.pipe(v.array(RemoteString), v.maxLength(MAX_REMOTE_ARRAY_ITEMS))),
	v.transform((value) => value ?? undefined)
);
