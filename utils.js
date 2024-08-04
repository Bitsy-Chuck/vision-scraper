import {createReadStream} from 'fs';
import readline from 'readline';
import winston from 'winston';

export async function image_to_base64(image_file) {
    return new Promise((resolve, reject) => {
        const stream = createReadStream(image_file);
        const chunks = [];
        stream.on('data', (chunk) => chunks.push(chunk));
        stream.on('end', () => {
            const buffer = Buffer.concat(chunks);
            const base64Data = buffer.toString('base64');
            const dataURI = `data:image/jpeg;base64,${base64Data}`;
            resolve(dataURI);
        });
        stream.on('error', reject);
    });
}

export async function input(text) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    return new Promise((resolve) => {
        rl.question(text, (answer) => {
            rl.close();
            resolve(answer);
        });
    });
}

export const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

export function extractJSONWithSchema(text) {
    function findJSONObjects(str) {
        const objects = [];
        let depth = 0;
        let start = -1;
        let inString = false;
        let escapeNext = false;

        for (let i = 0; i < str.length; i++) {
            const char = str[i];

            if (inString) {
                if (char === '"' && !escapeNext) inString = false;
                escapeNext = char === '\\' && !escapeNext;
            } else {
                if (char === '{') {
                    if (depth === 0) start = i;
                    depth++;
                } else if (char === '}') {
                    depth--;
                    if (depth === 0 && start !== -1) {
                        objects.push(str.substring(start, i + 1));
                        start = -1;
                    }
                } else if (char === '"') {
                    inString = true;
                }
            }
        }

        return objects;
    }

    function isValidSchema(obj) {
        return obj &&
            typeof obj === 'object' &&
            Array.isArray(obj.actions) &&
            obj.actions.every(action =>
                action &&
                typeof action === 'object' &&
                ['url', 'click', 'input'].includes(action.type) &&
                typeof action.value === 'string' &&
                (action.type !== 'click' && action.type !== 'input' || typeof action.elementId === 'number')
            ) &&
            Array.isArray(obj.order_of_execution) &&
            obj.order_of_execution.every(index =>
                Number.isInteger(index) &&
                index >= 0 &&
                index < obj.actions.length
            );
    }

    const jsonObjects = findJSONObjects(text);
    return jsonObjects
        .map(jsonStr => {
            try {
                return JSON.parse(jsonStr);
            } catch {
                return null;
            }
        })
        .filter(isValidSchema);
}

export const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.printf(({timestamp, level, message}) => {
            return `${timestamp} [${level}]: ${message}`;
        })
    ),
    transports: [
        new winston.transports.Console(),
        new winston.transports.File({filename: 'application.log'})
    ]
});
