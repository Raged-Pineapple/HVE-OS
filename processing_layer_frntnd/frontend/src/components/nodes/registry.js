// Dynamically import all node components in subdirectories
const nodeModules = import.meta.glob('./*/*.jsx', { eager: true });

export const nodeRegistry = Object.values(nodeModules)
  .filter(mod => mod.config && mod.default)
  .map(mod => ({
    ...mod.config,
    component: mod.default
  }));

export const getNodeTypes = () => {
  const types = {};
  nodeRegistry.forEach(node => {
    types[node.type] = node.component;
  });
  return types;
};

export const getNodesByCategory = () => {
  const categories = {};
  nodeRegistry.forEach(node => {
    if (!categories[node.category]) categories[node.category] = [];
    categories[node.category].push(node);
  });
  return categories;
};
