import networkx as nx
import importlib
import logging
import pandas as pd
from typing import Dict, Any, List

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.models.dataset import Dataset
from app.models.lineage import Lineage
from app.models.raw_data import RawData
from app.transforms.base import BaseTransform

logger = logging.getLogger(__name__)

class PipelineEngine:
    def __init__(self, db: AsyncSession):
        self.db = db
        self.dag = nx.DiGraph()
        self.datasets: Dict[str, Dataset] = {}
        
    async def load_graph(self):
        """Build DAG from defined Datasets in DB"""
        result = await self.db.execute(select(Dataset))
        datasets = result.scalars().all()
        
        for ds in datasets:
            self.datasets[ds.name] = ds
            self.dag.add_node(ds.name)
            for input_name in ds.inputs:
                self.dag.add_edge(input_name, ds.name)
                
    async def execute_all(self):
        """Execute the entire DAG in topological order"""
        if not nx.is_directed_acyclic_graph(self.dag):
            raise ValueError("Pipeline configuration contains a cycle.")
            
        execution_order = list(nx.topological_sort(self.dag))
        logger.info(f"Execution order: {execution_order}")
        
        # Temporary in-memory storage for intermediate dataframes
        data_store: Dict[str, pd.DataFrame] = {}
        
        for node in execution_order:
            if node not in self.datasets:
                # It's a raw input (like 'raw_weather')
                # Load from raw_data
                data_store[node] = await self._fetch_raw_data(node)
                continue
                
            dataset_conf = self.datasets[node]
            logger.info(f"Executing dataset transform: {node}")
            
            # Prepare inputs
            inputs_for_node = {}
            for inp in dataset_conf.inputs:
                if inp in data_store:
                    inputs_for_node[inp] = data_store[inp]
                    
            # Load and execute transform
            transform_class = self._load_transform(dataset_conf.transform_script)
            if transform_class:
                transform_instance = transform_class()
                try:
                    output_df = await transform_instance.process(inputs_for_node)
                    data_store[node] = output_df
                    # Record Lineage
                    await self._record_lineage(node, dataset_conf.inputs, status="success")
                except Exception as e:
                    logger.error(f"Error executing transform '{node}': {e}")
                    await self._record_lineage(node, dataset_conf.inputs, status="failed")
                    raise
            else:
                logger.warning(f"Transform script '{dataset_conf.transform_script}' not found for {node}")
                
        return {"status": "success", "executed_nodes": execution_order}
        
    async def _fetch_raw_data(self, source_name: str) -> pd.DataFrame:
        """Fetch raw data acting as a source node (e.g. from an API connector id)"""
        # In a real app we might filter by timestamp or status.
        # For prototype, fetch all payload JSONs for a specific connector ID.
        result = await self.db.execute(select(RawData).where(RawData.connector_id == source_name))
        raw_items = result.scalars().all()
        
        if not raw_items:
            return pd.DataFrame()
            
        # Extract payload into dataframe
        payloads = [item.payload for item in raw_items]
        return pd.DataFrame(payloads)
        
    def _load_transform(self, script_name: str) -> Any:
        try:
            if script_name == "clean_weather":
                from app.transforms.clean_weather import CleanWeatherTransform
                return CleanWeatherTransform
            elif script_name == "compute_risk":
                from app.transforms.compute_risk import ComputeRiskTransform
                return ComputeRiskTransform
            elif script_name == "graph_sink":
                from app.transforms.graph_sink import GraphSinkTransform
                return GraphSinkTransform
            elif script_name == "ai_kalman":
                from app.transforms.ai_transform import KalmanFilterTransform
                return KalmanFilterTransform
            elif script_name == "ai_predict":
                from app.transforms.ai_transform import RiskPredictionTransform
                return RiskPredictionTransform
                
            # Dynamic loading example:
            # module = importlib.import_module(f"app.transforms.{script_name}")
            # return getattr(module, "TransformClass")
        except ImportError as e:
            logger.error(f"Could not import transform {script_name}: {e}")
            return None
            
    async def _record_lineage(self, output: str, inputs: List[str], status: str):
        lineage_record = Lineage(
            output_dataset=output,
            derived_from=inputs,
            status=status
        )
        self.db.add(lineage_record)
        await self.db.commit()
