import {it,expect} from 'vitest';
import {parseServiceAreas,serviceAreaError} from './serviceCatalogForm';
it('normalizes owner free-text areas without inventing geography',()=>{expect(parseServiceAreas(' Phoenix metro, Peoria, Glendale and Surprise ')).toEqual(['Phoenix metro','Peoria','Glendale and Surprise']);});
it('requires a valid area or explicit unknown and rejects API-invalid lengths',()=>{expect(serviceAreaError('')).toContain('haven’t confirmed');expect(serviceAreaError('',true)).toBeNull();expect(serviceAreaError('P')).toContain('2–80');expect(serviceAreaError('A'.repeat(81))).toContain('2–80');expect(serviceAreaError('Arizona')).toBeNull();});
