/**
 * Pagination Utility
 * Parses query parameters and returns formatted pagination options
 */

export const getPaginationOptions = (query) => {
  const page = parseInt(query.page, 10) || 1;
  const limit = parseInt(query.limit, 10) || 10;
  const skip = (page - 1) * limit;

  // Sorting
  const sortBy = query.sortBy || 'createdAt';
  const sortOrder = query.sortOrder === 'asc' ? 1 : -1;
  const sort = { [sortBy]: sortOrder };

  return { page, limit, skip, sort };
};

export const formatPaginatedResponse = (data, totalDocuments, page, limit) => {
  const totalPages = Math.ceil(totalDocuments / limit);
  return {
    docs: data,
    meta: {
      totalDocuments,
      totalPages,
      currentPage: page,
      limit,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1,
    }
  };
};
