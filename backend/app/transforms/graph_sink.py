import pandas as pd
from typing import Dict
from app.transforms.base import BaseTransform
from app.services.ontology_mapper import OntologyMapper

class GraphSinkTransform(BaseTransform):
    def __init__(self):
        self.mapper = OntologyMapper()

    async def process(self, inputs: Dict[str, pd.DataFrame]) -> pd.DataFrame:
        """
        Takes inputs and pushes them to the graph. 
        Returns an aggregated summary or just empty dataframe as this is a sink.
        """
        if "clean_weather" in inputs:
            await self.mapper.ingest_clean_weather(inputs["clean_weather"])
            
        if "risk_score" in inputs:
            await self.mapper.ingest_risk_score(inputs["risk_score"])
            
        # Return empty DF to signal the DAG pipeline that transformation finished
        return pd.DataFrame({"graph_ingested": [True]})
