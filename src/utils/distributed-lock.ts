import { randomUUID } from "crypto";
import { redis } from '../config/redis';

export class DistributedLock {
    /** 
     * Tenta adquirir um lock distribuído no Redis. 
     * @param key Chave indentificadora do recurso (ex: lock:ticket_tier:UUID)
     * @param ttlMs Tempo de vida do Lock em milissegundos (default: 5000ms)
     * @returns O token indentificador em caso de sucesso, ou null se já estiver ocupado.
     */
    static async acquire(key: string, ttlMs: number = 5000): Promise<string | null> {
        const lockToken = randomUUID()

        // 'PX': expiração em ms | 'NX' só seta se não existir
        const result = await redis.set(key, lockToken, 'PX', ttlMs, 'NX');
        return result === 'OK' ? lockToken : null;
    }

    /**
     * Libera o lock de forma atômica via script Lua apenas se o token corresponder.
     * @param key Chave identificadora do recurso
     * @param lockToken Token retornado no momento do acquire
     * @returns boolean indicando se o lock foi liberado com sucesso
     */
    static async release(key: string, lockToken: string): Promise<boolean> {
        const luaScript = `
            if redis.call("get", KEYS[1]) == ARGV[1] then
                return redis.call("del", KEYS[1])
            else
                return 0
            end
        `;

        const result = await redis.eval(luaScript, 1, key, lockToken);
        return result === 1;
    }
}