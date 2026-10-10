import { StringSession } from 'telegram/sessions/index.js';

const MAX_ENTITIES = 10_000;
type EntityRow = ReturnType<StringSession['_entitiesToRows']>[number];

/** GramJS stores fresh row arrays in a Set, which does not deduplicate peers. */
export class TelegramSession extends StringSession {
    private readonly peers = new Map<string, EntityRow>();

    override processEntities(value: unknown): void {
        for (const row of this._entitiesToRows(value)) {
            const key = row[0].toString();
            const previous = this.peers.get(key);
            if (previous) this._entities.delete(previous);
            this.peers.delete(key);
            this.peers.set(key, row);
            this._entities.add(row);
            if (this.peers.size > MAX_ENTITIES) {
                const oldest = this.peers.keys().next().value!;
                this._entities.delete(this.peers.get(oldest)!);
                this.peers.delete(oldest);
            }
        }
    }
}
