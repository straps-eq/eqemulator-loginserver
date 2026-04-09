
	// Also refresh live server list types from DB (set by web auto-tier sync)
	try {
		auto lt_results = database.QueryDatabase(
			"SELECT id, login_server_list_type_id FROM login_world_servers "
			"WHERE federation_source_node_id IS NULL OR federation_source_node_id = 0"
		);
		if (lt_results.Success()) {
			for (auto lt_row = lt_results.begin(); lt_row != lt_results.end(); ++lt_row) {
				uint32_t db_id = std::stoul(lt_row[0]);
				unsigned int list_type = static_cast<unsigned int>(std::stoi(lt_row[1] ? lt_row[1] : "0"));
				for (auto &ws : m_world_servers) {
					if (ws->GetServerId() == db_id && ws->GetServerListID() != list_type) {
						LogInfo("Refreshing server [{}] list type [{}] -> [{}]",
							ws->GetServerLongName(), ws->GetServerListID(), list_type);
						ws->SetServerListTypeId(list_type);
					}
				}
			}
		}
	} catch (const std::exception &e) {
		LogError("RefreshLiveServerListTypes: {}", e.what());
	}
