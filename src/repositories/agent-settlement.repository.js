import BaseRepository from './base.repository.js';
import AgentSettlement from '../modules/agent-settlement.model.js';

class AgentSettlementRepository extends BaseRepository {
  constructor() {
    super(AgentSettlement);
  }
}

export default new AgentSettlementRepository();
