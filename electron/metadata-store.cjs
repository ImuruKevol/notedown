const fsSync = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const METADATA_DB_FILE = 'metadata.db';
const SCHEMA_VERSION = 1;

function metadataPath(storagePath) {
    return path.join(storagePath, METADATA_DB_FILE);
}

function parseJson(value, fallback) {
    if (!value) return fallback;
    try {
        return JSON.parse(value);
    } catch (error) {
        return fallback;
    }
}

function withMetadataDb(storagePath, callback) {
    fsSync.mkdirSync(storagePath, { recursive: true });
    const db = new DatabaseSync(metadataPath(storagePath));
    try {
        ensureSchema(db);
        return callback(db);
    } finally {
        db.close();
    }
}

function ensureSchema(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS metadata_document (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            schema_version INTEGER NOT NULL,
            version INTEGER NOT NULL,
            generated_at TEXT,
            extra_json TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS metadata_workspaces (
            id TEXT PRIMARY KEY,
            position INTEGER NOT NULL,
            body_json TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS metadata_notes (
            relative_path TEXT PRIMARY KEY,
            note_id TEXT,
            workspace_id TEXT,
            title TEXT,
            updated_at_ms INTEGER,
            position INTEGER NOT NULL,
            body_json TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_metadata_notes_workspace
            ON metadata_notes(workspace_id);

        CREATE INDEX IF NOT EXISTS idx_metadata_notes_updated
            ON metadata_notes(updated_at_ms);

        CREATE TABLE IF NOT EXISTS metadata_attachments (
            relative_path TEXT PRIMARY KEY,
            note_relative_path TEXT NOT NULL,
            attachment_id TEXT,
            position INTEGER NOT NULL,
            body_json TEXT NOT NULL,
            FOREIGN KEY(note_relative_path)
                REFERENCES metadata_notes(relative_path)
                ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_metadata_attachments_note
            ON metadata_attachments(note_relative_path);
    `);
}

function readMetadata(storagePath) {
    if (!fsSync.existsSync(metadataPath(storagePath))) return null;

    return withMetadataDb(storagePath, db => {
        const document = db.prepare(`
            SELECT version, generated_at, extra_json
            FROM metadata_document
            WHERE id = 1
        `).get();
        if (!document) return null;

        const metadata = {
            ...parseJson(document.extra_json, {}),
            version: Number(document.version) || 1,
            generatedAt: document.generated_at || null,
            workspaces: [],
            notes: []
        };

        const workspaceRows = db.prepare(`
            SELECT body_json
            FROM metadata_workspaces
            ORDER BY position ASC, id ASC
        `).all();
        metadata.workspaces = workspaceRows
            .map(row => parseJson(row.body_json, null))
            .filter(Boolean);

        const noteRows = db.prepare(`
            SELECT relative_path, body_json
            FROM metadata_notes
            ORDER BY position ASC, relative_path ASC
        `).all();
        const attachmentRows = db.prepare(`
            SELECT note_relative_path, body_json
            FROM metadata_attachments
            ORDER BY note_relative_path ASC, position ASC, relative_path ASC
        `).all();
        const attachmentsByNote = new Map();
        for (const row of attachmentRows) {
            const attachment = parseJson(row.body_json, null);
            if (!attachment) continue;
            const list = attachmentsByNote.get(row.note_relative_path) || [];
            list.push(attachment);
            attachmentsByNote.set(row.note_relative_path, list);
        }

        metadata.notes = noteRows
            .map(row => {
                const note = parseJson(row.body_json, null);
                if (!note) return null;
                note.attachments = attachmentsByNote.get(row.relative_path) || [];
                return note;
            })
            .filter(Boolean);

        return metadata;
    });
}

function writeMetadata(storagePath, metadata) {
    return withMetadataDb(storagePath, db => {
        db.exec('BEGIN IMMEDIATE');
        try {
            db.exec(`
                DELETE FROM metadata_attachments;
                DELETE FROM metadata_notes;
                DELETE FROM metadata_workspaces;
                DELETE FROM metadata_document;
            `);

            const {
                version = 1,
                generatedAt = null,
                workspaces = [],
                notes = [],
                ...extra
            } = metadata || {};

            db.prepare(`
                INSERT INTO metadata_document (
                    id,
                    schema_version,
                    version,
                    generated_at,
                    extra_json
                )
                VALUES (1, ?, ?, ?, ?)
            `).run(
                SCHEMA_VERSION,
                Number(version) || 1,
                generatedAt || null,
                JSON.stringify(extra)
            );

            const workspaceStatement = db.prepare(`
                INSERT OR REPLACE INTO metadata_workspaces (
                    id,
                    position,
                    body_json
                )
                VALUES (?, ?, ?)
            `);
            workspaces.forEach((workspace, index) => {
                if (!workspace?.id) return;
                workspaceStatement.run(
                    String(workspace.id),
                    index,
                    JSON.stringify(workspace)
                );
            });

            const noteStatement = db.prepare(`
                INSERT OR REPLACE INTO metadata_notes (
                    relative_path,
                    note_id,
                    workspace_id,
                    title,
                    updated_at_ms,
                    position,
                    body_json
                )
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `);
            const attachmentStatement = db.prepare(`
                INSERT OR REPLACE INTO metadata_attachments (
                    relative_path,
                    note_relative_path,
                    attachment_id,
                    position,
                    body_json
                )
                VALUES (?, ?, ?, ?, ?)
            `);

            notes.forEach((note, index) => {
                if (!note?.relativePath) return;
                const attachments = Array.isArray(note.attachments) ? note.attachments : [];
                const noteBody = { ...note, attachments: [] };
                delete noteBody.attachments;
                noteStatement.run(
                    String(note.relativePath),
                    note.id || null,
                    note.workspace || note.folder || null,
                    note.title || null,
                    Number.isFinite(Number(note.updatedAtMs)) ? Number(note.updatedAtMs) : null,
                    index,
                    JSON.stringify(noteBody)
                );

                attachments.forEach((attachment, attachmentIndex) => {
                    if (!attachment?.relativePath) return;
                    attachmentStatement.run(
                        String(attachment.relativePath),
                        String(note.relativePath),
                        attachment.id || attachment.attachmentId || null,
                        attachmentIndex,
                        JSON.stringify(attachment)
                    );
                });
            });

            db.exec('COMMIT');
        } catch (error) {
            db.exec('ROLLBACK');
            throw error;
        }

        return metadata;
    });
}

module.exports = {
    METADATA_DB_FILE,
    metadataPath,
    readMetadata,
    writeMetadata
};
