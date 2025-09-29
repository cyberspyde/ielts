export interface SimpleTableGradedEntry {
	key: string;
	baseKey: string;
	questionType: string;
	questionNumber?: number;
	studentAnswer: any;
	correctAnswer: string | null;
	points: number;
	isCorrect: boolean;
}

export interface NormalizedSimpleTableAnswer {
	type: 'simple_table';
	version: number;
	graded: SimpleTableGradedEntry[];
	cells?: Record<string, any>;
	[key: string]: any;
}

const normalizeString = (value: any): string => String(value ?? '').trim().toLowerCase();
const uniqueStrings = (values: string[]): string[] => {
	const seen = new Set<string>();
	values.forEach((value) => {
		if (!seen.has(value)) {
			seen.add(value);
		}
	});
	return Array.from(seen);
};

const parseMetadata = (metadataInput: any): any => {
	if (!metadataInput) return null;
	if (typeof metadataInput === 'string') {
		try {
			return JSON.parse(metadataInput);
		} catch {
			return null;
		}
	}
	if (typeof metadataInput === 'object') return metadataInput;
	return null;
};

const coerceCells = (value: any): Record<string, any> => {
	if (value && typeof value === 'object' && !Array.isArray(value)) {
		return value as Record<string, any>;
	}
	return {} as Record<string, any>;
};

const asObject = (value: any): Record<string, any> => {
	if (value && typeof value === 'object' && !Array.isArray(value)) {
		return { ...value };
	}
	return {} as Record<string, any>;
};

const splitStudentString = (raw: string, expectedLength: number): any[] | null => {
	const attempts = [
		raw.split(';'),
		raw.split(','),
		raw.split(/\s+/)
	].map((tokens) => tokens.map((token) => token.trim()).filter(Boolean));
	for (const tokens of attempts) {
		if (tokens.length === expectedLength) return tokens;
	}
	return null;
};

const coerceNumeric = (value: string): number | null => {
	if (!value || !/^[-+]?(\d+\.?\d*|\.\d+)$/.test(value)) return null;
	const parsed = Number(value);
	return Number.isNaN(parsed) ? null : parsed;
};

export const normalizeSimpleTableAnswer = (
	rawAnswer: any,
	metadataInput: any
): NormalizedSimpleTableAnswer => {
	const baseAnswer = asObject(rawAnswer);

	const existingGraded = Array.isArray((baseAnswer as any).graded) ? (baseAnswer as any).graded : [];
	if (existingGraded.length > 0 && (baseAnswer as any).type === 'simple_table') {
		return {
			...baseAnswer,
			type: 'simple_table',
			version: (baseAnswer as any).version ?? 2,
		} as NormalizedSimpleTableAnswer;
	}

	const metadata = parseMetadata(metadataInput);
	const rows: any[][] = Array.isArray(metadata?.simpleTable?.rows) ? metadata.simpleTable.rows : [];

	const cells = coerceCells((baseAnswer as any).cells);
	const graded: SimpleTableGradedEntry[] = [];

	rows.forEach((row, rowIndex) => {
		if (!Array.isArray(row)) return;
		row.forEach((cell, cellIndex) => {
			if (!cell || typeof cell !== 'object') return;
			if (cell.type !== 'question') return;

			const baseKey = `${rowIndex}_${cellIndex}`;
			const questionType = cell.questionType || 'fill_blank';
			const points = Number(cell.points ?? 1) || 1;
			const correctRaw = typeof cell.correctAnswer === 'string' ? cell.correctAnswer : '';
			const studentValRaw = cells[baseKey];

			const groups = correctRaw.includes(';') ? correctRaw.split(';') : [correctRaw];
			const multiNumbers: number[] = Array.isArray(cell.multiNumbers)
				? cell.multiNumbers
						.map((num: any) => Number(num))
						.filter((num: number) => Number.isFinite(num))
				: [];

			let blankCount = Math.max(
				multiNumbers.length || 0,
				Array.isArray(studentValRaw) ? studentValRaw.length : 0,
				groups.length > 1 ? groups.length : 1,
				1
			);
			if (blankCount < 1) blankCount = 1;

			const baseNumber = typeof cell.questionNumber === 'number'
				? cell.questionNumber
				: (multiNumbers.length ? multiNumbers[0] : undefined);

			let studentArray: any[] | null = null;
			if (Array.isArray(studentValRaw)) {
				studentArray = studentValRaw;
			} else if (blankCount > 1 && typeof studentValRaw === 'string') {
				studentArray = splitStudentString(studentValRaw, blankCount);
			}

			for (let blankIndex = 0; blankIndex < blankCount; blankIndex += 1) {
				const groupRaw = groups[blankIndex] ?? groups[0] ?? '';
				const variants = groupRaw.split('|').map(normalizeString).filter(Boolean);
				let studentValue: any;
				if (studentArray) {
					studentValue = studentArray[blankIndex];
				} else if (blankCount === 1) {
					studentValue = studentValRaw;
				} else {
					studentValue = undefined;
				}
				const studentNorm = normalizeString(studentValue);
				let isCorrect = false;

				if (questionType === 'multiple_choice') {
					const expectedSet = uniqueStrings(variants);
					const receivedSet = uniqueStrings(studentNorm ? studentNorm.split('|').filter(Boolean) : []);
					isCorrect = expectedSet.length > 0 && expectedSet.length === receivedSet.length && expectedSet.every((value) => receivedSet.includes(value));
				} else if (questionType === 'true_false') {
					const tfMap: Record<string, string> = { t: 'true', f: 'false', ng: 'not given', notgiven: 'not given' };
					const expected = tfMap[variants[0]] || variants[0];
					const received = tfMap[studentNorm] || studentNorm;
					isCorrect = !!expected && expected === received;
				} else {
								const numericExpected = variants.length > 0 && variants.every((value: string) => /^[-+]?(\d+\.?\d*|\.\d+)$/.test(value));
					if (numericExpected) {
						const receivedNumeric = coerceNumeric(studentNorm);
									isCorrect = receivedNumeric !== null && variants.some((value: string) => Number(value) === receivedNumeric);
					} else {
									isCorrect = variants.some((value: string) => value === studentNorm);
					}
				}

				graded.push({
					key: blankCount > 1 ? `${baseKey}_b${blankIndex}` : baseKey,
					baseKey,
					questionType,
					questionNumber: multiNumbers[blankIndex] ?? (baseNumber !== undefined ? (blankCount > 1 ? baseNumber + blankIndex : baseNumber) : undefined),
					studentAnswer: studentValue ?? null,
					correctAnswer: groupRaw || null,
					points,
					isCorrect,
				});
			}
		});
	});

	return {
		...baseAnswer,
		type: 'simple_table',
		version: (baseAnswer as any).version ?? 2,
		cells,
		graded,
	};
};

export const ensureSimpleTableNormalized = (
	rawAnswer: any,
	metadataInput: any
): NormalizedSimpleTableAnswer => normalizeSimpleTableAnswer(rawAnswer, metadataInput);

