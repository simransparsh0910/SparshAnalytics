import React, { useState } from 'react';
import './Pagination.css';

const Pagination = ({ itemsPerPage, totalItems, paginate, currentPage }) => {
    const pageNumbers = [];
    const [currentGroup, setCurrentGroup] = useState(1);
    const pagesPerGroup = 10;
    const totalPages = Math.ceil(totalItems / itemsPerPage);

    for (let i = 1; i <= totalPages; i++) {
        pageNumbers.push(i);
    }

    const startIndex = (currentGroup - 1) * pagesPerGroup;
    const endIndex = Math.min(startIndex + pagesPerGroup, totalPages);
    const currentPages = pageNumbers.slice(startIndex, endIndex);

    const handleNextGroup = () => {
        if (endIndex < totalPages) {
            setCurrentGroup(currentGroup + 1);
        }
    };

    const handlePreviousGroup = () => {
        if (currentGroup > 1) {
            setCurrentGroup(currentGroup - 1);
        }
    };
    //console.log('startIndex:', startIndex);
//console.log('endIndex:', endIndex);
//console.log('currentGroup:', currentGroup);

    return (
        <div>
            <nav>
                <ul className="pagination">
                    {currentGroup > 1 && (
                        <li>
                            <button onClick={handlePreviousGroup}>Previous</button>
                        </li>
                    )}

                    {currentPages.map((number) => (
                        <li key={number} className={number === currentPage ? 'active' : ''}>
                            <a onClick={() => paginate(number)} href="#">
                                {number}
                            </a>
                        </li>
                    ))}

                    {endIndex < totalPages && (
                        <li>
                            <button onClick={handleNextGroup}>Next</button>
                        </li>
                    )}
                </ul>
            </nav>
        </div>
    );
};

export default Pagination;
